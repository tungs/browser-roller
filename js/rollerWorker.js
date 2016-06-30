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
        messenger: messenger
      }).then(function(bundle){
        var code = bundle.generate({format:message.format, moduleName:message.moduleName}).code;
        console.log(code);
        postMessage({type:"rolled", message: code});
      }).catch(function(err){
        console.warn(err);
      });
	} 
});