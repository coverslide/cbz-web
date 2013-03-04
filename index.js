var send = require('send')
var WSFTP = require('wsftp')

module.exports = function(root, server, path){
  server.on('request', function(req, res){
    send(req, req.url)
      .root(__dirname + '/public')
      .pipe(res)
  })
  var bindOptions = {server: server}
  if(path) bindOptions.path = path
  new WSFTP(bindOptions, root)
}
