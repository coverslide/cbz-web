'use strict'

var WebSocketServer = require('ws').Server
var levelup = require('levelup')
var path = require('path')
var PkzipParser = require('pkzip-parser')
var fs = require('fs')

require('mkee')(CbzInfo)

module.exports = CbzInfo

function CbzInfo(connection, root, dbpath){
  var db, _this = this
  var wss = new WebSocketServer(connection)
  var inProgress = {}

  if(dbpath){
    levelup(dbpath, {encoding: 'json'}, function(err, idb){
      if(err) _this.emit('error', err)
      //db = idb
    })
  }

  wss.on('connection', onConnection)

  return _this

  function onConnection(socket){
    var requestRead = false
    var request
    var pathname
    var open = true

    socket.on('error', onError)
    socket.on('message', onMessage)
    socket.on('close', function(){
      open = false
    })

    function onError(err){
      _this.emit('error', err)
    }

    function onMessage(message){
      if(!requestRead){
        requestRead = true // all subsequent messages are ignored
        try{
          request = JSON.parse(message)
        } catch(err){
          return sendError(err.message)
        }
        if(!request.url){
          return sendError("URL parameter not found")
        }
      }
      var url = path.normalize('/' + request.url)
      var dbkey = 'cbz-info?file=' + url
      var pathname = path.join(root, url)
      if(request.del && db){
        db.del(dbkey, function(err){
          if(err) return sendError(err)
          else socket.send('true')
          socket.close(1000)
        })
      }
      //does a sanity check that the file still exists
      fs.stat(pathname, function(err, stat){
        if(err) return sendError(err)
        if(stat.isDirectory()) return sendError(new Error('Cannot Request Directory Info'))
        var running = inProgress[url]
        if(running){
          send({stat:stat, files:running.files, more: true})
          running.parser.on('file', function(header, position){
            send({file:{header: header, position: position}})
          })
          running.parser.on('end', function(){
            end()
          })
          running.parser.on('error', function(err){
            sendError(err)
          })
        } else if(db){
          db.get(dbkey, function(err, val){
            if(err){
              if(err.name == "NotFoundError"){
                send({stat: stat})
                var parser = streamFileInfo(pathname)
                inProgress[url] = {parser:parser,files:[]}
                var files = inProgress[url].files
                parser.on('file', function(header, position, stream){
                  files.push({header: header, position: position})
                  send({file:{header: header, position: position}})
                })
                parser.on('end', function(){
                  inProgress[url] = null
                  end()
                  db.put(dbkey, files, function(err){
                    if(err) _this.emit('error', err)
                  })
                })
                parser.on('error', function(err){
                  inProgress[url] = null
                  sendError(err)
                })
              } else {
                sendError(err)
              }
            } else {
              send({stat: stat, files: val})
              end()
            }
          })
        } else {
          send({stat: stat})
          var parser = streamFileInfo(pathname)
          inProgress[url] = {parser:parser,files:[]}
          var files = inProgress[url].files
          parser.on('file', function(header, position){
            files.push({header: header, position: position})
            send({file:{header: header, position: position}})
          })
          parser.on('end', function(){
            inProgress[url] = null
            end()
          })
        }
      })
    }

    function streamFileInfo(pathname){
      var stream = fs.createReadStream(pathname)
      var parser = new PkzipParser()
      stream.pipe(parser)
      return parser
    }

    function end(){
      send({end:true})
      socket.close(1000)
    }

    function send(data){
      if(!open) return
      socket.send(JSON.stringify(data))
    }

    function sendError(err){
      if(!open) return
      socket.send(JSON.stringify({error: err.message || err}))
      socket.close(1011)
    }
  }
}
