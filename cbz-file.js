'use strict'

//middleware for extracting individual files from zip as http gzip encoding

var fs = require('fs')
var parseUrl = require('url').parse
var path = require('path')
var mime = require('mime')

var PkzipParser = require('pkzip-parser')

var zlib = require('zlib')

module.exports = CbzFile

function CbzFile(root){
  return function(req, res){
    var url = parseUrl(req.url, true)
    var filename = decodeURIComponent(url.query.path)
    var pathname = path.normalize('/' + filename)
    var filepath = path.join(root, pathname)

    fs.stat(filepath, function(err, stat){
      if(err) sendError(err, err.name == 'NotFounError' && 404)
      else if(stat.isDirectory()) sendError('Path is directory')
      else {

        var ETag = stat.size.toString(16) + '-' + (+stat.mtime).toString(16)
        if(req.headers['if-none-match'] == ETag){
          res.statusCode = 304
          return res.end()
        }


        var decompress = url.query.decompress
        var offset = +url.query.offset
        var end = +url.query.end
        var parser = new PkzipParser()
        var fstream = fs.createReadStream(filepath, {start:offset,end:end})

        fstream.pipe(parser)

        parser.once('file', function(header, position, stream){
          if(header.compressionType == 'uncompressed'){
            res.setHeader('ETag', ETag)
            res.setHeader('Content-Type', mime.lookup(header.fileName))
            res.setHeader('Content-Length', header.uncompressedSize)
            stream.pipe(res)
            //stream.on('end', end)
          } else if(header.compressionType == 'deflate'){
            if(decompress){
              res.setHeader('ETag', ETag)
              res.setHeader('Content-Type', mime.lookup(header.fileName))
              res.setHeader('Content-Length', header.uncompressedSize)
              var deflate = zlib.createDeflateRaw()
              stream.pipe(deflate)
              deflate.pipe(res)
              //deflate.on('end', end)
            } else {
              //Aww Yiss, wrap the compressed data in a gzip header
              var headerBuffer = new Buffer(10)// + header.fileName.length + 1)
              headerBuffer.writeUInt16LE(0x8b1f, 0, true)
              headerBuffer.writeUInt8(0x8, 2, true)//compression type deflate
              headerBuffer.writeUInt8(0x0, 3, true)//no filename
              headerBuffer.writeUInt32LE(~~(Date.now() / 1000), 4, true)//timestamp
              headerBuffer.writeUInt8(0x3, 9, true) //OS type unix
              //new Buffer(header.fileName).copy(headerBuffer,10)

              var footerBuffer = new Buffer(8)
              footerBuffer.writeUInt32LE(0, header.crc32, true)
              footerBuffer.writeUInt32LE(4, header.uncompressedSize, true)
              res.setHeader('ETag', ETag)
              res.setHeader('Content-Encoding', 'gzip')
              res.setHeader('Content-Type', mime.lookup(header.fileName))
              res.setHeader('Content-Length', header.compressedSize + headerBuffer.length + footerBuffer.length)
              res.write(headerBuffer)
              stream.on('data', function(data){
                res.write(data)
              })
              stream.on('end', function(data){
                if(data) res.write(data)
                res.write(footerBuffer)
                res.end()
                //end()
              })
            }
          } else {
            sendError('Compression type not recognized')
          }

          function staticHeaders(){
            if (!res.getHeader('Date')) res.setHeader('Date', new Date().toUTCString());
            if (!res.getHeader('Cache-Control')) res.setHeader('Cache-Control', 'public, max-age=' + 86400);
          }

          function end(){
            parser.destroy()
            stream.destroy()
            fstream.destroy()
          }
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
