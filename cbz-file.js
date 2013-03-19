'use strict'

//middleware for extracting individual files from zip as http gzip encoding

var fs = require('fs')
var parseUrl = require('url').parse
var path = require('path')
var mime = require('mime')

//var PkzipParser = require('pkzip-parser')

var zlib = require('zlib')

module.exports = CbzFile

function CbzFile(root, decompress){
  return function(req, res){
    var url = parseUrl(req.url, true)
    var filename = decodeURIComponent(url.query.path)
    var pathname = path.normalize('/' + filename)
    var filepath = path.join(root, pathname)

    fs.stat(filepath, function(err, stat){
      if(err) sendError(err, err.name == 'ENOENT' && 404)
      else if(stat.isDirectory()) sendError('Path is directory')
      else {

        var ETag = stat.size.toString(16) + '-' + (+stat.mtime).toString(16)
        if(req.headers['if-none-match'] == ETag){
          res.statusCode = 304
          return res.end()
        }

        var offset = +url.query.offset
        var end = +url.query.end

        fs.open(filepath, 'r', function(err, fd){
          if(err) return sendError(err)
          var header = new Buffer(30)
          fs.read(fd, header, 0, 30, offset, function(err){
            if(err) return sendError(err)
            var signature = header.readUInt32LE(0, true)
            if(signature != 0x04034b50) return sendError('Invalid file offset')
            var flags = header.readUInt16LE(6, true)
            var filenameLength = header.readUInt16LE(26, true)
            var extrafieldLength = header.readUInt16LE(28, true)
            var headerSize = 30 + filenameLength + extrafieldLength

            var crc32, csize, usize
            if(flags & 0x8){//data descriptor is present, therefore usize & csize will be 0 in the header
              //we could also use the CD for this data
              var dd = new Buffer(12)
              var ddStart = offset + headerSize + end
              fs.read(fd, dd, 0, 12, ddStart, function(){
                var offset = 4
                var ddSig = dd.readUInt32LE(0, true)
                //signature is optional, but that doesn't help me much
                if(ddSig != 0x08074b50) sendError('Data Descriptor signature not present')//offset -= 4
                crc32 = dd.readUInt32LE(offset, true)
                csize = dd.readUInt32LE(offset + 4, true)
                usize = dd.readUInt32LE(offset + 8, true)
                afterRead()
              })
            } else {
              crc32 = header.readUInt32LE(14, true)
              csize = header.readUInt32LE(18, true)
              usize = header.readUInt32LE(22, true)
              afterRead()
            }

            function afterRead(){
              var compressionId = header.readUInt16LE(8, true)
              var fnBuf = new Buffer(filenameLength)
              fs.read(fd, fnBuf, 0, filenameLength, offset + 30, function(err){
                if(err) return sendError(err)
                var cfilename = fnBuf.toString()
                var stream = fs.createReadStream(null, {fd:fd, start: offset + headerSize, end: end})
                if(compressionId == 0){// uncompressed
                  res.setHeader('ETag', ETag)
                  res.setHeader('Content-Type', mime.lookup(cfilename))
                  res.setHeader('Content-Length', usize)
                  stream.pipe(res)
                } else if(compressionId == 0x8){
                  if(decompress){
                    res.setHeader('ETag', ETag)
                    res.setHeader('Content-Type', mime.lookup(cfilename))
                    res.setHeader('Content-Length', usize)
                    var inflate = zlib.createInflateRaw()
                    stream.pipe(inflate)
                    inflate.pipe(res)
                  } else {
                    var encodings = req.headers['accept-encoding'] || ''
                    if(!encodings.match(/\bgzip\b/)){
                      return sendError('Gzip encoding not supported')
                    }
                    var headerBuffer = new Buffer(10)// + header.fileName.length + 1)
                    headerBuffer.writeUInt16LE(0x8b1f, 0, true)
                    headerBuffer.writeUInt8(0x8, 2, true)//compression type deflate
                    headerBuffer.writeUInt8(0x0, 3, true)//no filename
                    headerBuffer.writeUInt32LE(~~(Date.now() / 1000), 4, true)//timestamp
                    headerBuffer.writeUInt8(0x3, 9, true) //OS type unix
                    //new Buffer(header.fileName).copy(headerBuffer,10)

                    var footerBuffer = new Buffer(8)
                    footerBuffer.writeUInt32LE(0, crc32, true)
                    footerBuffer.writeUInt32LE(4, usize, true)
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
            }
          })
        })
      }
    })

    function sendError(err, code){
      res.statusCode = code || 500
      res.write(err.message || err)
      res.end()
    }
  }
}
