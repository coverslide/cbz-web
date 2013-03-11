'use strict'

var send = require('send')
var CbzInfo = require('./cbz-info')
var CbzFile = require('./cbz-file')
var JsonDir = require('./json-dir')
var parseUrl = require('url').parse

module.exports = function(config, server){
  if(!config.root)
    throw new Error('Root directory not specified')

  var cbzFile = new CbzFile(config.root)
  var cbzInfo = new CbzInfo(config.root, config.db)
  var jsonDir = new JsonDir(config.root)

  server.on('request', function(req, res){
    //check for gzip encoding
    var encodings = req.headers['accept-encoding']
    if(encodings){
      var hasGzip = encodings.split(',').indexOf('gzip') > -1
    }
    if(!hasGzip){
      return send(req, '/nogzip.html')
        .root(__dirname + '/public')
        .pipe(res)
    }

    if(req.url.match(/^\/cbz-file/)){
      cbzFile(req, res)
    } else if(req.url.match(/^\/cbz-info/)){
      cbzInfo(req, res)
    } else if(req.url.match(/^\/json-dir/)){
      jsonDir(req, res)
    } else {
      send(req, req.url)
        .root(__dirname + '/public')
        .pipe(res)
    }
  })
}
