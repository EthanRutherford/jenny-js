const privacyMap = new WeakMap();
let okToConstruct = null;
const indexModulo = (m, n) => m < 0 ? (m % n) + n : m;

const canAssign = (val) => val && val.constructor === Object || val instanceof Array;

function deepAssign(target, source) {
	if (!canAssign(target) || !canAssign(source)) return source;

	for (let key in source) {
		target[key] = deepAssign(target[key], source[key]);
	}

	return target;
}

class JennyContentArray extends Array {
	constructor(...args) {
		super(...args);
		this._parent = this[0] ? this[0].parentNode : null;
	}
	push(...items) {
		return super.push.call(this, ...this._parent.append(...items));
	}
	pop() {
		return super.pop.call(this).remove();
	}
	unshift(...items) {
		return super.unshift.call(this, ...this._parent.prepend(...items));
	}
	shift() {
		return super.shift.call(this).remove();
	}
	sort(compare) {
		super.sort.call(this, compare);
		this._parent.append(...this);
		return this;
	}
	reverse() {
		super.reverse.call(this);
		this._parent.append(...this);
		return this;
	}
	splice(start, count, ...items) {
		start = indexModulo(start, this.length);
		if (this[start]) {
			this[start].before(...items);
		} else {
			this._parent.append(...items);
		}
		return super.splice.call(this, start, count, ...items).map((item) => item.remove());
	}
	replace(index, ...newItems) {
		let items = this[index].replaceWith(...newItems);
		super.splice.call(this, index, 1, ...items);
	}
}

class JennyElement extends Element {
	get content() {
		return new JennyContentArray(...this.childNodes);
	}
	set content(newContent) {
		while (this.lastChild) this.lastChild.remove();
		this.append(...newContent);
	}
	get computedStyle() {
		return getComputedStyle(this);
	}
	get class() {return this.classList;}
	set class(name) {return this.classList = name;}
}

class Controller {
	constructor() {
		if (this.constructor !== okToConstruct) {
			throw new Error("Illegal constructor");
		}

		let descriptors = Object.getOwnPropertyDescriptors(this.__proto__);
		let names = Object.keys(descriptors).filter((name) => {
			return !["constructor", "init"].includes(name) && descriptors[name].value instanceof Function;
		});
		for (let name of names) {
			this[name] = this[name].bind(this);
		}

		this.props = {};
		okToConstruct = null;
	}
	init() {
		return null;
	}
	updateProps(newProps) {
		let oldProps = deepAssign({}, this.props);
		this.props = deepAssign(this.props, newProps);
		validate(true, this.constructor.name, "", this.props, PropTypes.shapeOf(this.constructor.propTypes || {}));
		if (this.propsChanged instanceof Function) {
			this.propsChanged(oldProps);
		}
	}
	get model() {
		return privacyMap.get(this);
	}
	remove() {
		this.model.remove();
	}
}

(function updateInterfaces() {
	function methodReplacer(oldFunc, returnThis = false) {
		return function(...nodes) {
			nodes = nodes.map((node) => prepareNode(node));
			oldFunc.call(this, ...nodes);
			observerCallback(observer.takeRecords());
			return returnThis ? this : nodes;
		};
	}

	(function updateChildNodesInterface(prototypes) {
		for (let prototype of prototypes) {
			prototype.before = methodReplacer(prototype.before);
			prototype.after = methodReplacer(prototype.after);
			prototype.replaceWith = methodReplacer(prototype.replaceWith);
			prototype.remove = methodReplacer(prototype.remove, true);
		}
	})([Element.prototype, CharacterData.prototype, DocumentType.prototype]);

	(function updateParentNodesInterface(prototypes) {
		for (let prototype of prototypes) {
			prototype.append = methodReplacer(prototype.append);
			prototype.prepend = methodReplacer(prototype.prepend);
		}
	})([Element.prototype, Document.prototype, DocumentFragment.prototype]);

	function nodeWrapper(oldFunc) {
		return function(...args) {
			let result = oldFunc.call(this, ...args);
			observerCallback(observer.takeRecords());
			return result;
		};
	}

	Node.prototype.appendChild = nodeWrapper(Node.prototype.appendChild);
	Node.prototype.insertBefore = nodeWrapper(Node.prototype.insertBefore);
	Node.prototype.removeChild = nodeWrapper(Node.prototype.removeChild);
	Node.prototype.replaceChild = nodeWrapper(Node.prototype.replaceChild);
	HTMLElement.prototype.__proto__ = JennyElement.prototype;
})();

function jController(tag, children) {
	if (tag.length > 2 || tag.length === 0) {
		throw new Error("bad tag");
	}

	const Controller = okToConstruct = tag[0];
	let controller = new Controller();
	let props = Object.assign({children}, tag[1]);
	if (props.ref) {
		controller._ref = props.ref;
		delete props.ref;
	}

	controller.props = props;
	validate(true, Controller.name, "", controller.props, PropTypes.shapeOf(Controller.propTypes || {}));
	let model = controller.init();
	if (model !== null) {
		model.controller = controller;
		privacyMap.set(controller, model);
	}

	return controller;
}

function j(tag, children = []) {
	if (tag instanceof Array) {
		return jController(tag, children);
	}
	if (Object.keys(tag).length !== 1) {
		throw new Error("bad tag");
	}

	let tagName = Object.keys(tag)[0];
	let props = Object.assign({}, tag[tagName]);
	let elem = document.createElement(tagName);
	if (props.ref) {
		elem._ref = props.ref;
		delete props.ref;
	}

	for (let prop of Object.keys(props)) {
		elem[prop] = props[prop];
	}

	elem.append(...children.filter((child) => child != null));
	return elem;
}

function prepareNode(node) {
	return node instanceof Controller ? node.model : node;
}

function attach(node) {
	for (let child of node.children || []) {
		attach(child);
	}
	if (node._ref instanceof Function) {
		node._ref(node);
	}
	if (node.controller) {
		if (node.controller._ref instanceof Function) {
			node.controller._ref(node.controller);
		}
		if (node.controller.didMount instanceof Function) {
			node.controller.didMount();
		}
	}
}

function detach(node) {
	for (let child of node.children || []) {
		detach(child);
	}
	if (node._ref instanceof Function) {
		node._ref(null);
	}
	if (node.controller) {
		if (node.controller._ref instanceof Function) {
			node.controller._ref(null);
		}
		if (node.controller.didUnmount instanceof Function) {
			node.controller.didUnmount();
		}
	}
}

function observerCallback(mutations) {
	for (let mutation of mutations) {
		for (let node of mutation.addedNodes) {
			attach(node);
		}
		for (let node of mutation.removedNodes) {
			detach(node);
		}
	}
}

const observer = new MutationObserver(observerCallback);
observer.observe(document.body, {childList: true, subtree: true});

function validate(required, constructor, name, prop, propType, typeName = propType.name) {
	if (prop == null) {
		if (required) {
			console.warn(`Missing prop '${name}: ${typeName}' in ${constructor}`);
		}
		return;
	}
	if (propType.prototype) {
		if (!(prop.constructor === propType || prop instanceof propType)) {
			console.warn(`Failed propType '${name}: ${typeName}' in ${constructor}`);
		}
	} else {
		propType(constructor, name, prop);
	}
}

const PropTypes = {
	required: (propType) => (constructor, name, prop) => {
		validate(true, constructor, name, prop, propType);
	},
	arrayOf: (propType) => (constructor, name, prop) => {
		validate(false, constructor, name, prop, Array);
		for (let x of prop) {
			validate(false, constructor, name, x, propType, `arrayOf(${propType.name})`);
		}
	},
	shapeOf: (shape) => (constructor, name, prop) => {
		validate(false, constructor, name, prop, Object);
		for (let name in shape) {
			validate(false, constructor, name, prop[name], shape[name]);
		}
	},
};

module.exports = {Controller, j, PropTypes};
