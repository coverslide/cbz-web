'use strict'

//middleware for extracting individual files from zip as http gzip encoding

var fs = require('fs')
var parseUrl = require('url').parse
var path = require('path')
var mime = require('mime')

var zlib = require('zlib')

module.exports = CbzFile

function CbzFile(root){
  return function(req, res){
    var url = parseUrl(req.url, true)
    var filename = decodeURIComponent(url.query.path)
    var pathname = path.normalize('/' + filename)
    var filepath = path.join(root, pathname)
    var fd

    fs.stat(filepath, function(err, stat){
      if(err) sendError(err, err.name == 'ENOENT' && 404)
      else if(stat.isDirectory()) sendError('Path is directory')
      else {

        var ETag = 'v3-' + stat.size.toString(16) + '-' + (+stat.mtime).toString(16)
        if(req.headers['if-none-match'] == ETag){
          res.statusCode = 304
          return res.end()
        }

        var cdOffset = +url.query.cd

        fs.open(filepath, 'r', function(err, _fd){
          if(err) return sendError(err)
          fd = _fd
          var cdHeader = new Buffer(46)
          fs.read(fd, cdHeader, 0, 46, cdOffset, function(err){
            if(err) return sendError(err)
            var signature = cdHeader.readUInt32LE(0, true)
            if(signature != 0x02014b50) return sendError('Invalid cd signature')
            var offset = cdHeader.readUInt32LE(42, true)
            var crc32 = cdHeader.readUInt32LE(16, true)
            var csize = cdHeader.readUInt32LE(20, true)
            var usize = cdHeader.readUInt32LE(24, true)
            var header = new Buffer(30)

            fs.read(fd, header, 0, 30, offset, function(err){
              if(err) return sendError(err)
              var signature = header.readUInt32LE(0, true)
              if(signature != 0x04034b50) return sendError('Invalid file offset')
              var filenameLength = header.readUInt16LE(26, true)
              var extrafieldLength = header.readUInt16LE(28, true)
              var headerSize = 30 + filenameLength + extrafieldLength

              var compressionId = header.readUInt16LE(8, true)
              var fnBuf = new Buffer(filenameLength)
              fs.read(fd, fnBuf, 0, filenameLength, offset + 30, function(err){
                if(err) return sendError(err)
                var cfilename = fnBuf.toString().split(/\//g).reverse()[0]
                var stream = fs.createReadStream(null, {fd:fd, start: offset + headerSize, end: offset + headerSize + csize - 1})
                if(compressionId == 0){// uncompressed
                  res.setHeader('ETag', ETag)
                  res.setHeader('Content-Type', mime.lookup(cfilename))
                  res.setHeader('Content-Length', usize)
                  stream.pipe(res)
                } else if(compressionId == 0x8){
                  var encodings = req.headers['accept-encoding'] || ''
                  if(!encodings.match(/\bgzip\b/)){
                    res.setHeader('ETag', ETag)
                    res.setHeader('Content-Type', mime.lookup(cfilename))
                    res.setHeader('Content-Length', usize)
                    var inflate = zlib.createInflateRaw()
                    stream.pipe(inflate)
                    inflate.pipe(res)
                  } else {
                    var headerBuffer = new Buffer(10)// + cfilename.length + 1)
                    headerBuffer.writeUInt16LE(0x8b1f, 0, true)
                    headerBuffer.writeUInt8(0x8, 2, true)//compression type deflate
                    headerBuffer.writeUInt8(0x0, 3, true)//no filename
                    headerBuffer.writeUInt32LE(~~(Date.now() / 1000), 4, true)//timestamp
                    headerBuffer.writeUInt8(0x3, 9, true) //OS type unix
                    //new Buffer(cfilename).copy(headerBuffer,10)

                    var footerBuffer = new Buffer(8)
                    footerBuffer.writeUInt32LE(crc32, 0, true)
                    footerBuffer.writeUInt32LE(usize, 4, true)
                    res.setHeader('ETag', ETag)
                    res.setHeader('Content-Encoding', 'gzip')
                    res.setHeader('Content-Type', mime.lookup(cfilename))
                    res.setHeader('Content-Length', csize + headerBuffer.length + footerBuffer.length)
                    res.write(headerBuffer)
                    stream.on('data', function(data){
                      res.write(data)
                    })
                    stream.on('end', function(data){
                      if(data) res.write(data)
                      res.write(footerBuffer)
                      res.end()
                    })
                  }
                }
              })
            })
          })
        })
      }
    })

    function sendError(err, code){
      if(fd)
        fs.close(fd)
      res.statusCode = code || 500
      res.write(err.message || err)
      res.end()
    }
  }
}
