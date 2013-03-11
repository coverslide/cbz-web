'use strict'

var fs = require('fs')
var path = require('path')
var parseUrl = require('url').parse

var PkzipParser = require('pkzip-parser')

module.exports = CbzInfo

function CbzInfo(root){

  //TODO: add caching so I'm not hitting the disk so much
  return function(req, res){
    var url = parseUrl(req.url, true)
    var filename = decodeURIComponent(url.query.path)
    var pathname = path.normalize('/' + filename)
    var filepath = path.join(root, pathname)

    var chunked = url.query.chunked

    fs.stat(filepath, function(err, stat){
      if(err) sendError(err, err.name == 'NotFoundError' && 404)
      else if(!stat.isFile()) sendError('Not a file', 400)
      else{
      
        var ETag = stat.size.toString(16) + '-' + (+stat.mtime).toString(16)
        if(req.headers['if-none-match'] == ETag){
          res.statusCode = 304
          return res.end()
        }

        res.setHeader('ETag', ETag)

        var parser = new PkzipParser()
        var fstream = fs.createReadStream(filepath)

        var files = []

        parser.on('file', function(header, position){
          var data = {header:header,position:position} 
          if(chunked){
            res.write(JSON.stringify(data)+'\n')
          } else {
            files.push(data)
          }
        })

        parser.on('end', function(){
          if(!chunked){
            res.write(JSON.stringify(files))
          }
          res.end()
        })

        fstream.pipe(parser)
      }
    })

    function sendError(err, code){
      res.statusCode = code || 500
      res.end(err.message || err)
    }
  }
}

