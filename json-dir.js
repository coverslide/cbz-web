'use strict'

var fs = require('fs')
var path = require('path')
var parseUrl = require('url').parse

require('sort_by').bindToNative()

module.exports = JsonDir

function JsonDir(root){
  return function(req, res){
    var url = parseUrl(req.url, true)
    var filename = decodeURIComponent(url.query.path)
    var pathname = path.normalize('/' + filename)
    var filepath = path.join(root, pathname)

    var chunked = url.query.chunked

    fs.stat(filepath, function(err, stat){
      if(err) sendError(err, err.name == 'NotFoundError' && 404)
      else if(!stat.isDirectory()) sendError('Not a directory', 400)
      else{
        var files = []
        fs.readdir(filepath, function(err, children){
          if(err) sendError(err)
          children = children.sort_by(function(f){
            return f.split(/([0-9]+)/g).map(function(n){return +n == n ? +n : n})
          }).reverse()
          process()
          function process(){
            var file = children.pop()
            var data = {filename:file}

            if(file){
              var childname = path.join(filepath, file)
              fs.stat(childname, function(err, stat){
                if(err) data.error = err
                else data.size = stat.size
                if(stat) data.isdir = stat.isDirectory()
                if(chunked){
                  res.write(JSON.stringify(data) + '\n')
                } else {
                  files.push(data)
                }
                process()
              })
            } else {
              if(!chunked){
                res.write(JSON.stringify({files:files}))
              }
              res.end()
            }
          }
        })
      }
    })

    function sendError(err, code){
      res.statusCode = code || 500
      res.end(err.message || err)
    }
  }
}
