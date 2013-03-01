var send = require('send')
var FileSocketServer = require('filesocket-server')

module.exports = function(root){
  var files = new FileSocketServer({root: root})
  return {
    bind: function(server, path){
      server.on('request', function(req, res){
        send(req, req.url)
          .root(__dirname + '/public')
          .pipe(res)
      })
      var bindOptions = {server: server}
      if(path) bindOptions.path = path
      files.bind(bindOptions)
    }
  }
}
