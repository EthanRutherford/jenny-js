/*
	requirements
	self.js
*/
const self = require("./self.js").getSelf();

const arrayWrap = (obj) => obj == null ? [] : obj instanceof Array ? obj : [obj];

//these coallesce the two versions of getting/setting/deleting an attribute on an element
function getAttr(elem, property) {
	let val = elem[property];
	if (val != null)
		return val;
	return elem.getAttribute(property);
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

//handlers for special props
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

function contentArrayGetHandler(target, property) {
	if (property === "is_proxy")
		return true;
	return target[property];
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
			removeRef(target[property]);
			me._.elem.insertBefore(newNode, oldNode);
			oldNode.remove();
		} else {
			me._.elem.appendChild(newNode);
		}
		setRef(me._.owner, value);
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
			removeRef(target[property]);
			oldNode.remove();
		}
	}
	return delete target[property];
}

//model callback object literals
function modelGetAttr({property, me}) {
	let ans = getAttr(me._.elem, property);
	return ans instanceof Function ? undefined : ans;
}
const modelGetCallbacks = {
	is_proxy: () => true,
	tag: ({target}) => target.tag,
	on: ({target}) => target.on,
	class: ({target}) => target.class,
	content: ({target}) => target.content,
	computedStyle: ({me}) => window.getComputedStyle(me._.elem),
	text: ({me}) => modelGetAttr({me, property: "textContent"}),
};

function modelSetAttr({property, value, me}) {
	setAttr(me._.elem, property, value);
	return true;
}
const modelSetCallbacks = {
	is_proxy: () => false,
	tag: () => false,
	ref: () => false,
	text: () => false,
	computedStyle: () => false,
	on: ({target, value, me}) => {
		//remove all event handlers, then add new ones
		removeHandlers(target.on, me._.elem);
		target.on = proxifyHandlers(value, me.$);
		generateHandlers(target.on, me._.elem);
		return true;
	},
	class: ({target, value, me}) => {
		//remove classes, and add new ones
		me._.elem.removeAttribute("class");
		target.class = proxifyClasses(value, me.$);
		generateClasses(target.class, me._.elem);
		return true;
	},
	content: ({target, value, me}) => {
		//remove all content, then add new content
		removeContent(target.content);
		target.content = proxifyContent(value, me.$);
		let contents = arrayWrap(target.content);
		for (let content of contents)
			setRef(me._.owner, content);
		generateContent(target.content, me._.elem);
		return true;
	},
};

function modelDelAttr({property, me}) {
	//remove an attribute
	delAttr(me._.elem, property);
	return true;
}
const modelDelCallbacks = {
	is_proxy: () => false,
	tag: () => false,
	text: () => false,
	computedStyle: () => false,
	content: ({target}) => {
		//remove all content
		removeContent(target.content);
		return delete target.content;
	},
	on: ({target, me}) => {
		//remove all event handlers
		removeHandlers(target.on, me._.elem);
		target.on = proxifyHandlers({}, me.$);
		return true;
	},
	class: ({me}) => {
		//remove all classes
		me._.elem.removeAttribute("class");
		return true;
	},
};

//the model proxy handlers
function modelHasHandler(target, property) {
	let me = self(this._);
	return 
		property === "computedStyle" ||
		property in target ||
		(property in me._.elem && !(me._.elem[property] instanceof Function));
}
function modelGetHandler(target, property) {
	//if the value is not a special property, return it from the dom
	let me = self(this._);
	return (modelGetCallbacks[property] || modelGetAttr)({target, property, me});
}
function modelSetHandler(target, property, value) {
	let me = self(this._);
	return (modelSetCallbacks[property] || modelSetAttr)({target, property, value, me});
}
function modelDelHandler(target, property) {
	let me = self(this._);
	return (modelDelCallbacks[property] || modelDelAttr)({target, property, me});
}

//functions related to manipulating models
function removeHandlers(handlers, elem) {
	for (let handler in handlers)
		elem.removeEventListener(handler, handlers[handler]);
}

function removeContent(content) {
	content = arrayWrap(content);
	for (let item of content) {
		removeRef(item);
		self(item)._.elem.remove();
	}
}

function removeRef(model) {
	let me = self(model);
	//remove the ref
	if (me._.refname)
		delete me._.owner[me._.refname];
	//stop recursing when we hit a class
	if (model instanceof Element)
		return;
	//recurse into content
	let contents = arrayWrap(model.content);
	for (content of contents)
		removeRef(content);
}

function generateModelAttr({elem, property, model}) {
	setAttr(elem, property, model[property])
	delete model[property];
}
const generateModelCallbacks = {
	tag: () => {},
	on: ({elem, model}) => generateHandlers(model.on, elem),
	class: ({elem, model}) => generateClasses(model.class, elem),
	content: ({elem, model}) => generateContent(model.content, elem),
};
function generateModel(model) {
	//if text node, create text node
	if (model.text) {
		let elem = document.createTextNode(model.text);
		delete model.text;
		return elem;
	}
	//create the node
	let elem = document.createElement(model.tag);
	for (let property in model)
		(generateModelCallbacks[property] || generateModelAttr)({elem, property, model});
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
	if (content.is_proxy)
		return content;
	if (content instanceof Array) {
		for (let item in content)
			content[item] = proxifyModel(content[item]);
		//proxify array of content
		content = new Proxy(content, {
			get: contentArrayGetHandler.bind(proxy),
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
	return new ClassSet(classes, proxy);
}

//this method creates a proxy and an element for a given model
function proxifyModel(model) {
	//short circuit things that don't need to be proxified
	if (model instanceof Element || model.is_proxy)
		return model;
	//special case for tag instanceof Element
	if (model.tag instanceof Element) {
		self(model.tag)._.refname = model.ref;
		return model.tag;
	}
	//check for text nodes
	if (typeof model === "string" || typeof model === "number" || typeof model === "boolean")
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
	//if this is a text node, we have no props of any sort
	if (!model.text) {
		//proxify "on" property
		model.on = proxifyHandlers(model.on || {}, proxifiedModel);
		//proxify classes
		model.class = proxifyClasses(model.class || "", proxifiedModel);
		//proxify content models
		if (model.content != null)
			model.content = proxifyContent(model.content, proxifiedModel);
		//set and remove ref
		self(proxifiedModel)._.refname = model.ref;
		delete model.ref;
	}
	//generate the DOM node and set initial state
	self(proxifiedModel)._.elem = generateModel(model);
	
	return proxifiedModel;
}

//this method creates a proxy and a model for a given element
function proxifyElem(elem) {
	//if we arent a text or element type, we can't proxify it
	if (elem.nodeType !== Node.ELEMENT_NODE && elem.nodeType !== Node.TEXT_NODE)
		return;
	//create a new model
	let model = {};
	//create model hack (see proxifyModel for explanation)
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
	//if this is a text node, create a text model
	if (elem.nodeType === Node.TEXT_NODE) {
		//add the text property
		model.text = elem.textContent;
	} else if (elem.nodeType === Node.ELEMENT_NODE) {
		//add the tag name
		model.tag = elem.tagName.toLowerCase();
		//add the on property
		model.on = proxifyHandlers(model.on || {}, proxifiedModel);
		//create the class proxy
		model.class = proxifyClasses(elem.className, proxifiedModel);
		//remove the tmp_iter. we don't need it
		delete model.class.tmp_iter;
		//recurse through the child elements
		if (elem.hasChildNodes()) {
			if (elem.childNodes.length === 1) {
				//create the proxy for the content
				model.content = proxifyElem(elem.childNodes[0]);
			} else {
				//create an array of proxy content
				let content = [];
				for (let child of elem.childNodes)
					content.push(proxifyElem(child));
				//proxify array of content
				model.content = new Proxy(content, {
					set: contentArraySetHandler.bind(proxifiedModel),
					deleteProperty: contentArrayDelHandler.bind(proxifiedModel)
				});
			}
		}
	}
	//attatch the elem to the model
	self(proxifiedModel)._.elem = elem;
	
	return proxifiedModel;
}

function setRef(owner, model) {
	let me = self(model);
	//set the owner
	me._.owner = owner;
	//set the ref property
	if (me._.refname) {
		if (me._.refname in owner)
			throw {message: `'${me._.refname}' already present in Element`, obj: owner};
		Object.defineProperty(owner, me._.refname, {
			configurable: true,
			get: () => model
		});
	}
	//stop recursing when we hit a class
	if (model instanceof Element)
		return;
	//recurse into content
	let contents = arrayWrap(model.content);
	for (let content of contents)
		setRef(owner, content);
}

class ClassSet {
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
		setRef(this, me._.model);
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

//the root element
let Root;

const Jenny = {
	Element,
	get Root() {
		return Root;
	},
	set Root(elem) {
		Root = proxifyElem(elem);
	}
}

Object.freeze(Jenny);

module.exports = Jenny;

