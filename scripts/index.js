var domready = require('domready')
var document = require('global/document')

var CbzApp = require('cbz-browser-app')

domready(function(){
  var cbz = window.cbz = new CbzApp({parentElement: document.body})
})
