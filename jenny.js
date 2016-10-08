/*
	requirements
	self.js
*/
const self = require("./self.js").getSelf();

const arrayWrap = (obj) => obj == null ? [] : obj instanceof Array ? obj : [obj];
const nameOnlyRegEx = /^[a-z$_]+$/i;

//these coallesce the two versions of getting/setting/deleting an attribute on an element
function getAttr(elem, property) {
	return elem[property] || elem.getAttribute(property);
}
function setAttr(elem, property, value) {
	if (!value) {
		delAttr(elem, property);
	} else if (value === true) {
		elem.setAttribute(property, value);
	} else {
		elem[property] = value;
	}
}
function delAttr(elem, property) {
	elem[property] = null;
	elem.removeAttribute(property);
}

function modelOnSetHandler(target, property, value) {
	let me = self(this);
	me._.elem.removeEventListener(property, target[property]);
	me._.elem.addEventListener(property, value);
	target[property] = value;
	return true;
}
function modelOnDelHandler(target, property) {
	let me = self(this);
	me._.elem.removeEventListener(property, target[property]);
	return delete target[property];
}

function contentArraySetHandler(target, property, value) {
	let me = self(this);
	let i = Number(property);
	if (Number.isInteger(i)) {
		//initialize the new value
		value = proxifyModel(value);
		//get the old node
		let oldNode = me._.elem.childNodes[i];
		//and the new node
		let newNode = self(value)._.elem;
		//if the new node existed somewhere, replace it with a placeholder
		//this should hopefully only happen temporarily while moving nodes,
		//one should not absently clone nodes, as the copies are shallow
		if (newNode.parentNode) {
			//define a placeholder node, since nodes are moved, not copied
			let junkNode = document.createTextNode("MOVED ELSEWHERE");
			newNode.parentNode.insertBefore(junkNode, newNode);
			newNode.remove();
		}
		//if there was previously a node at this position, replace it
		//if there wasn't, we must be adding a new one
		if (oldNode) {
			removeRefs(target[property]);
			me._.elem.insertBefore(newNode, oldNode);
			oldNode.remove();
		} else {
			me._.elem.appendChild(newNode);
		}
		parseRefs(me._.parent, value)
	}
	target[property] = value;
	return true;
}
function contentArrayDelHandler(target, property) {
	let me = self(this);
	let i = Number(property);
	if (Number.isInteger(i)) {
		//if there is an element at this index, remove it
		let oldNode = me._.elem.childNodes[i];
		if (oldNode) {
			removeRefs(target[property]);
			oldNode.remove();
		}
	}
	return delete target[property];
}

function modelHasHandler(target, property) {
	let me = self(this._);
	return property in target || (property in me._.elem && !(me._.elem[property] instanceof Function));
}
function modelGetHandler(target, property) {
	//if the value is not a special property, return it from the dom
	let me = self(this._);
	switch (property) {
		//semi-hack to detect if we've already proxified this
		case "is_proxy":
			return true;
		//catch the special properties
		case "tag":
		case "on":
		case "class":
		case "content":
		case "refs":
			return target[property];
		case "text":
			property = "textContent";
		default:
			let ans = getAttr(me._.elem, property);
			return ans instanceof Function ? undefined : ans;
	}
}
function modelSetHandler(target, property, value) {
	let me = self(this._);
	switch (property) {
		case "tag":
		case "refs":
			return false;
		case "on":
			//remove all event handlers, then add new ones
			removeHandlers(target[property], me._.elem);
			value = proxifyHandlers(value, me.$);
			generateHandlers(value, me._.elem);
			break;
		case "class":
			//remove classes, and add new ones
			me._.elem.removeAttribute("class");
			value = proxifyClasses(value, me.$);
			generateClasses(value, me._.elem);
			break;
		case "content":
			//remove all content, then add new content
			removeContent(target[property]);
			value = proxifyContent(value, me.$);
			generateContent(value, me._.elem);
			break;
		case "text":
			property = "textContent";
		default:
			//change a property
			setAttr(me._.elem, property, value);
			return true;
	}
	target[property] = value;
	return true;
}
function modelDelHandler(target, property) {
	let me = self(this._);
	switch (property) {
		case "tag":
		case "refs":
		case "text":
			return false;
		case "content":
			//remove all content
			removeContent(target[property]);
			break;
		case "on":
			//remove all event handlers
			removeHandlers(target[property], me._.elem);
			return true;
		case "class":
			//remove all classes
			me._.elem.removeAttribute("class");
			return true;
		default:
			//remove an attribute
			delAttr(me._.elem, property);
			return true;
	}
	return delete target[property];
}

function removeHandlers(handlers, elem) {
	for (let handler in handlers)
		elem.removeEventListener(handler, handlers[handler]);
}

function removeContent(content) {
	content = arrayWrap(content);
	for (let item of content) {
		removeRefs(item);
		self(item)._.elem.remove();
	}
}

function removeRefs(model) {
	//stop recursing when we hit a class
	if (model instanceof Element)
		return;
	//unset the parent
	let me = self(model);
	let parent = me._.parent;
	me._.parent = null;
	//remove the refs
	let refs = model.refs;
	for (let ref in refs)
		delete parent[ref];
	//recurse into content
	let contents = arrayWrap(model.content);
	for (content of contents)
		removeRefs(content);
}

function generateModel(model) {
	//if text node, create text node
	if (model.text) {
		let elem = document.createTextNode(model.text);
		delete model.text;
		return elem;
	}
	//create the node
	let elem = document.createElement(model.tag);
	for (let prop in model) {
		switch (prop) {
			case "tag":
			case "refs":
				break;
			case "on":
				generateHandlers(model[prop], elem);
				break;
			case "class":
				generateClasses(model[prop], elem);
				break;
			case "content":
				generateContent(model[prop], elem);
				break;
			default:
				//anything else is assumed to be a property
				setAttr(elem, prop, model[prop])
				delete model[prop];
				break;
		}
	}
	return elem;
}

function generateHandlers(handlers, parent) {
	//object containing handlers
	for (let handler in handlers)
		parent.addEventListener(handler, handlers[handler]);
}

function generateClasses(classes, parent) {
	for (let item of classes.tmp_iter)
		parent.classList.add(item);
	delete classes.tmp_iter;
}

function generateContent(content, parent) {
	//array containing html content
	content = arrayWrap(content);
	for (let item of content)
		parent.appendChild(self(item)._.elem);
}

function proxifyHandlers(on, proxy) {
	return new Proxy(on, {
		set: modelOnSetHandler.bind(proxy),
		deleteProperty: modelOnDelHandler.bind(proxy)
	});
}

function proxifyContent(content, proxy) {
	if (content instanceof Array) {
		for (let item in content)
			content[item] = proxifyModel(content[item]);
		//proxify array of content
		content = new Proxy(content, {
			set: contentArraySetHandler.bind(proxy),
			deleteProperty: contentArrayDelHandler.bind(proxy)
		});
	} else {
		content = proxifyModel(content);
	}
	return content;
}

function proxifyClasses(classes, proxy) {
	if (typeof classes === "string")
		classes = classes.trim().split(/\s+/).filter((s) => s !== "");
	if (!(classes instanceof Array))
		classes = [];
	return new ClassSetProxy(classes, proxy);
}

function proxifyModel(model) {
	//short circuit things that don't need to be proxified
	if (model instanceof Element || model.is_proxy)
		return model;
	if (typeof model === "string")
		return proxifyModel({text: model});
	if (typeof model === "number" || typeof model == "boolean")
		return proxifyModel({text: model.toString()});
	//create proxified model
	//since we can't bind to proxifiedModel before we create it, we must hack
	//it in afterward by binding to an object, then adding proxifiedModel as a
	//property on that object
	let modelHack = {};
	let proxifiedModel = new Proxy(model, {
		has: modelHasHandler.bind(modelHack),
		get: modelGetHandler.bind(modelHack),
		set: modelSetHandler.bind(modelHack),
		deleteProperty: modelDelHandler.bind(modelHack)
	});
	modelHack._ = proxifiedModel;
	//init self for the proxy
	self.init(proxifiedModel);
	//proxify "on" property
	model.on = proxifyHandlers(model.on || {}, proxifiedModel);
	//proxify classes
	model.class = proxifyClasses(model.class || "", proxifiedModel);
	//proxify content models
	if (model.content != null)
		model.content = proxifyContent(model.content, proxifiedModel);
	//generate the DOM node and set initial state
	self(proxifiedModel)._.elem = generateModel(model);
	
	return proxifiedModel;
}

function parseRefs(parent, model) {
	//stop recursing when we hit a class
	if (model instanceof Element)
		return;
	//set the parent
	let me = self(model);
	me._.parent = parent;
	//prevent modification
	Object.freeze(model.refs);
	//parse the refs
	let refs = model.refs;
	for (let ref in refs) {
		if (!refs[ref].match(nameOnlyRegEx))
			throw {message: `'${refs[ref]}' has illegal characters`};
		if (ref in parent)
			throw {message: `'${ref}' already present in parent`, obj: parent};
		if (refs[ref] === "this") {
			Object.defineProperty(parent, ref, {
				configurable: true,
				get: () => {return model;}
			});
		} else {
			Object.defineProperty(parent, ref, {
				configurable: true,
				get: () => {return model[refs[ref]];},
				set: (value) => {return model[refs[ref]] = value;}
			});
		}
	}
	//recurse into content
	let contents = arrayWrap(model.content);
	for (content of contents)
		parseRefs(parent, content);
}

class ClassSetProxy {
	constructor(iterable, proxy) {
		this.tmp_iter = iterable;
		this.has = this.has.bind(proxy);
		this.add = this.add.bind(proxy);
		this.delete = this.delete.bind(proxy);
		this.clear = this.clear.bind(proxy);
		this.toString = this.toString.bind(proxy);
		this[Symbol.iterator] = this[Symbol.iterator].bind(proxy);
	}
	has(value) {
		let me = self(this);
		return me._.elem.classList.contains(value);
	}
	add(value) {
		let me = self(this);
		me._.elem.classList.add(value);
	}
	delete(value) {
		let me = self(this);
		me._.elem.classList.remove(value);
	}
	clear() {
		let me = self(this);
		me._.elem.removeAttribute("class");
	}
	toString() {
		let me = self(this);
		return me._.elem.classList.toString();
	}
	[Symbol.iterator]() {
		let me = self(this);
		return me._.elem.classList[Symbol.iterator]();
	}
}

class Element {
	constructor(model) {
		self.init(this);
		let me = self(this);
		me._.model = proxifyModel(model);
		parseRefs(this, me._.model);
		me._.elem = self(me._.model)._.elem;
	}
	get model() {
		let me = self(this);
		return me._.model;
	}
	remove() {
		let me = self(this);
		me._.elem.remove();
	}
}

const Jenny = {
	Element: Element,
	initDOM: (root) => {
		let me = self(root);
		document.body.appendChild(me._.elem);
	}
}

module.exports = Jenny;

