'use strict'

var send = require('send')
var WSFTP = require('wsftp')
var CbzInfo = require('./cbz-info')

module.exports = function(config, server){
  if(!config.root)
    throw new Error('Root directory not specified')
  server.on('request', function(req, res){
    send(req, req.url)
      .root(__dirname + '/public')
      .pipe(res)
  })
  new WSFTP({server: server, path: '/comics'}, config.root)
  new CbzInfo({server: server, path: '/cbz-info'}, config.root, config.db)
}
