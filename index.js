var send = require('send')
var WSFTP = require('wsftp')
var parseUrl = require('url').parse
var path = require('path')
var PkzipParser = require('pkzip-parser')
var fs = require('fs')
var levelup = require('levelup')

module.exports = function(config, server){
  var config = config || {}
  var root = config.root
  if(!root)
    throw new Error('Root directory not specified')
  if(config.db)
    var db = levelup(config.db, {encoding:'json'}, function(err, idb){
      if(err) db = null
    })
  var wspath = config.path
  var cache = {}

  server.on('request', function(req, res){
    if(req.url.match(/^\/cbz-info/)){
      url = parseUrl(req.url, true)
      if(url.query && url.query.file){
        var filename = path.normalize('/' + decodeURIComponent(url.query.file))
        var filepath = path.join(root, filename)
        var clear = url.query.clear
        var key = 'filestat?filename=' + filename

        if(clear){
          db.del(key, function(err){
            if(err) res.end(JSON.stringify(err))
            else res.end('OK')
          })
          return
        }

        fs.stat(filepath, function(err, filestat){
          if(err) return res.statusCode = 404,res.end(err.message)
          if(filestat.isDirectory())
            return res.end(JSON.stringify({dir:true,stat:filestat})) 
          db.get(key, function(err, value){
            if(err){
              if(err.name = 'NotFoundError'){
                var stream = fs.createReadStream(filepath)
                var parser = new PkzipParser()
                var files = []

                stream.pipe(parser)
                parser.on('file', function(stat){
                  var data = {
                    filename: stat.fileName
                    , offset: stat.offset 
                    , length: stat.length
                    , end: stat.offset + stat.length
                    , headerSize: stat.headerSize
                    , compressedSize: stat.compressedSize
                  }
                  files.push(data)
                })
                parser.on('end', function(){
                  db.put(key, files)
                  sendResult()
                })
              } else {
                sendError(err) 
              }
            } else {
              files = value
              sendResult()
            }

            function sendResult(){
              res.end(JSON.stringify({stat:filestat,files:files})) 
            }

            function sendError(error){
              res.end(JSON.stringify({error: error.message || error})) 
            }
          })
        })
      } else {
        res.satusCode = 400
        res.setHeader('content-type','text/html')
        res.end('<h1>400 Bad Request</h1>')
      }
    } else {
      send(req, req.url)
        .root(__dirname + '/public')
        .pipe(res)
    }
  })
  var bindOptions = {server: server}
  if(wspath) bindOptions.path = wspath
  new WSFTP(bindOptions, root)
}
