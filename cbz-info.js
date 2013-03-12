'use strict'

var fs = require('fs')
var path = require('path')
var parseUrl = require('url').parse

require('sort_by').bindToNative()

//var PkzipParser = require('pkzip-parser')

module.exports = CbzInfo

var END_SIG   = 0x06054b50
var CD_SIG    = 0x02014b50
var FILE_SIG  = 0x04034b50

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


        //let's use the FD and just check the central directory
        fs.open(filepath, 'r', function(err, fd){
          if(err) return sendError(err)
          var endOffset = stat.size - 22
          var endData =  new Buffer(22)
          fs.read(fd, endData, 0, 22, endOffset, function(err, bytes){
            if(err) return sendError(err)
            var signature = endData.readUInt32LE(0,true)
            if(signature != END_SIG) return sendError("Invalid End signature")
            var cdOffset = endData.readUInt32LE(16, true)
            var entryCount = endData.readUInt16LE(10, true)
            var entries = []
            var entriesCompleted = 0
            var lastFile = null

            readNext()

            function readNext(){
              var cdData = new Buffer(46)
              fs.read(fd, cdData, 0, 46, cdOffset, function(err, bytes){
                var signature = cdData.readUInt32LE(0, true)
                if(signature != CD_SIG) return sendError("Invalid CD signature")
                var filenameLength = cdData.readUInt16LE(28, true)
                var extrafieldLength = cdData.readUInt16LE(30, true)
                var commentLength = cdData.readUInt16LE(32, true)
                var dataSize = cdData.readUInt32LE(20, true) 
                var fileOffset = cdData.readUInt32LE(42, true)

                var varLength = filenameLength + extrafieldLength + commentLength
                var extraData = new Buffer(varLength)
                fs.read(fd, extraData, 0, varLength, cdOffset + 46, function(err, bytes){
                  if(err) return sendError(Err)
                  cdOffset += 46 + varLength
                  var filename = extraData.slice(0, filenameLength).toString()
                  if(lastFile)
                    lastFile.end = fileOffset - 1
                  lastFile = {filename:filename, offset:fileOffset}
                  entries.push(lastFile)
                  if(entries.length < entryCount)
                    readNext()
                  else{
                    lastFile.end = endOffset - 1
                    printEntries()
                  }
                })
              })
            }

            function printEntries(){
              res.setHeader('ETag', ETag)
              entries
                .sort_by(function(e){return e.filename})
                .forEach(function(e){res.write(JSON.stringify(e) + '\n')})
              res.end()
            }
          })
        })

        return

        var parser = null//new PkzipParser()
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

