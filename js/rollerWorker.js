importScripts("../libs/rollup.browser.js","npmloader.js","npmroller.js");

var messenger = function(message){
	postMessage({type:"messenger", message: message});
};

self.addEventListener('message', function(e) {
	var type = e.data.type;
	var message = e.data.message;
	if(type === "roll"){
    npmroller.roll({
      configjs: message.configjs,
      symbols: message.symbols,
      preferredVersions: message.preferredVersions,
      messenger: messenger
    }).then(function(bundle){
      var code = bundle.generate({format:message.format, moduleName:message.moduleName}).code;
      postMessage({type:"rolled", message: code});
    }).catch(function(err){
      postMessage({type:"rolling error", message: err});
      console.warn(err);
    });
	} 
});