(() => {
	//map of all loaded modules
	const loaded = {};
	//Regex for getting requirements comment
	const requirementsRegex = /\/\*\s*requirements((?:\s|\S)*?)\*\//;
	const splitRegex = /\S+/g;
	//reads the source for requirements
	function getRequirements(code) {
		let reqs = (code.match(requirementsRegex) || [])[1] || "";
		return reqs.match(splitRegex) || [];
	}
	//executes the code, and returns the result of module.exports
	function execute(code) {
		let module = {};
		(new Function("module", code)).call(null, module);
		return module.exports;
	}
	//call to load the resource
	function load(src) {
		//return a promise which 
		return new Promise((resolve, reject) => {
			let request = new XMLHttpRequest();
			request.open("get", src);
			request.onload = () => {
				if (request.status === 200) {
					resolve(request.response);
				} else {
					reject(Error("Module failed to load, status: " + request.statusText));
				}
			}
			request.onerror = () => {
				reject(Error("Module failed to load due to network error"));
			}
			request.send();
		});
	}
	//require call, which exports to window.require
	this.require = function(src) {
		//if it is in the loaded map, it was already preloaded
		//otherwise, we must preload it, and all of it's dependencies
		if (loaded[src])
			return loaded[src];
		//set loaded to empty object
		loaded[src] = {};
		//return a promise which resolves when the module is loaded
		return new Promise((resolve, reject) => {
			//load the module
			load(src).then((result) => {
				//get the requirements
				let reqs = getRequirements(result);
				//call require on all requirements, and
				//when done, resolve with no value needed
				Promise.all(reqs.map(require)).then(() => {
					loaded[src] = execute(result);
					resolve(loaded[src]);
				}).catch((error) => {
					reject(error);
				});
			}).catch((error) => {
				reject(error);
			});
		});
	}
	Object.freeze(require);
})();

