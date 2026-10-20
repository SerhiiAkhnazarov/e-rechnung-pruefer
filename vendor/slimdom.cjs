"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except2, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except2)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// slimdom.js/src/index.ts
var src_exports = {};
__export(src_exports, {
  Attr: () => Attr,
  CDATASection: () => CDATASection,
  CharacterData: () => CharacterData,
  Comment: () => Comment,
  DOMException: () => DOMException,
  DOMImplementation: () => DOMImplementation,
  DOMParser: () => DOMParser,
  Document: () => Document,
  DocumentFragment: () => DocumentFragment,
  DocumentType: () => DocumentType,
  Element: () => Element2,
  MutationObserver: () => MutationObserver,
  MutationRecord: () => MutationRecord,
  Node: () => Node,
  ProcessingInstruction: () => ProcessingInstruction,
  Range: () => Range,
  StaticRange: () => StaticRange,
  Text: () => Text,
  XMLDocument: () => XMLDocument,
  XMLSerializer: () => XMLSerializer,
  document: () => document2,
  parseXmlDocument: () => parseXmlDocument,
  parseXmlFragment: () => parseXmlFragment,
  serializeToWellFormedString: () => serializeToWellFormedString,
  unsafeAppendAttribute: () => unsafeAppendAttribute,
  unsafeCreateAttribute: () => unsafeCreateAttribute,
  unsafeCreateElement: () => unsafeCreateElement
});
module.exports = __toCommonJS(src_exports);

// slimdom.js/src/mutation-observer/RegisteredObserver.ts
var RegisteredObserver = class {
  /**
   * @param observer - The observer being registered
   * @param node     - The node being observed
   * @param options  - Options for the registration
   * @param source   - If non-null, creates a transient registered observer for the given
   *                   registered observer
   */
  constructor(observer, node, options, source) {
    /**
     * A transient observer is an observer that has a source which is an observer.
     */
    this.source = null;
    this.observer = observer;
    this.node = node;
    this.options = options;
    this.source = source || null;
    if (source) {
      observer._transients.push(this);
    }
  }
  /**
   * Adds the given mutationRecord to the NotifyList of the registered MutationObserver. It only
   * adds the record when it's type isn't blocked by one of the flags of this registered
   * MutationObserver options (formally the MutationObserverInit object).
   *
   * @param type                - The type of mutation record to queue
   * @param target              - The target node
   * @param data                - The data for the mutation record
   * @param interestedObservers - Array of mutation observer objects to append to
   * @param pairedStrings       - Paired strings for the mutation observer objects
   */
  collectInterestedObservers(type, target, data, interestedObservers, pairedStrings) {
    if (this.node !== target && !this.options.subtree) {
      return;
    }
    if (type === "attributes" && !this.options.attributes) {
      return;
    }
    if (type === "characterData" && !this.options.characterData) {
      return;
    }
    if (type === "childList" && !this.options.childList) {
      return;
    }
    let index = interestedObservers.indexOf(this.observer);
    if (index < 0) {
      index = interestedObservers.length;
      interestedObservers.push(this.observer);
      pairedStrings.push(void 0);
    }
    if (type === "attributes" && this.options.attributeOldValue || type === "characterData" && this.options.characterDataOldValue) {
      pairedStrings[index] = data.oldValue;
    }
  }
};

// slimdom.js/src/mutation-observer/RegisteredObservers.ts
var RegisteredObservers = class {
  /**
   * @param node - Node for which this instance holds RegisteredObserver instances.
   */
  constructor(node) {
    this._registeredObservers = [];
    this._node = node;
  }
  /**
   * Registers a given MutationObserver with the given options.
   *
   * @param observer - Observer to create a registration for
   * @param options  - Options for the registration
   */
  register(observer, options) {
    const registeredObservers = this._registeredObservers;
    let hasRegisteredObserverForObserver = false;
    registeredObservers.forEach((registered) => {
      if (registered.observer !== observer) {
        return;
      }
      hasRegisteredObserverForObserver = true;
      removeTransientRegisteredObserversForSource(registered);
      registered.options = options;
    });
    if (!hasRegisteredObserverForObserver) {
      this._registeredObservers.push(new RegisteredObserver(observer, this._node, options));
      observer._nodes.push(this._node);
    }
  }
  /**
   * Removes the given transient registered observer.
   *
   * Transient registered observers never have a corresponding entry in the observer's list of
   * nodes. They are guaranteed to be present in the array, as MutationObserver#_transients and
   * RegisteredObservers#_registeredObservers are kept in sync.
   *
   * @param transientRegisteredObserver - The registered observer to remove
   */
  removeTransientRegisteredObserver(transientRegisteredObserver) {
    this._registeredObservers.splice(
      this._registeredObservers.indexOf(transientRegisteredObserver),
      1
    );
  }
  /**
   * Remove any registered observer on the associated node for which observer is the observer.
   *
   * As this only occurs for all nodes at once, it is the caller's responsibility to remove the
   * associated node from the observer's list of nodes.
   *
   * @param observer - Observer for which to remove the registration
   */
  removeForObserver(observer) {
    let write = 0;
    for (let read = 0, l = this._registeredObservers.length; read < l; ++read) {
      const registered = this._registeredObservers[read];
      if (registered.observer === observer) {
        continue;
      }
      if (read !== write) {
        this._registeredObservers[write] = registered;
      }
      ++write;
    }
    this._registeredObservers.length = write;
  }
  /**
   * Determines interested observers for the given record.
   *
   * @param type                - The type of mutation record to queue
   * @param target              - The target node
   * @param data                - The data for the mutation record
   * @param interestedObservers - Array of mutation observer objects to append to
   * @param pairedStrings       - Paired strings for the mutation observer objects
   */
  collectInterestedObservers(type, target, data, interestedObservers, pairedStrings) {
    this._registeredObservers.forEach((registeredObserver) => {
      registeredObserver.collectInterestedObservers(
        type,
        target,
        data,
        interestedObservers,
        pairedStrings
      );
    });
  }
  /**
   * Append transient registered observers for any registered observers whose options' subtree is
   * true.
   *
   * @param node - Node to append the transient registered observers to
   */
  appendTransientRegisteredObservers(node) {
    this._registeredObservers.forEach((registeredObserver) => {
      if (registeredObserver.options.subtree) {
        node._registeredObservers.registerTransient(registeredObserver);
      }
    });
  }
  /**
   * Appends a transient registered observer for the given registered observer.
   *
   * @param source - The source registered observer
   */
  registerTransient(source) {
    this._registeredObservers.push(
      new RegisteredObserver(source.observer, this._node, source.options, source)
    );
  }
};
function removeTransientRegisteredObserversForObserver(observer) {
  observer._transients.forEach((transientRegisteredObserver) => {
    transientRegisteredObserver.node._registeredObservers.removeTransientRegisteredObserver(
      transientRegisteredObserver
    );
  });
  observer._transients.length = 0;
}
function removeTransientRegisteredObserversForSource(source) {
  for (let i = source.observer._transients.length - 1; i >= 0; --i) {
    const transientRegisteredObserver = source.observer._transients[i];
    if (transientRegisteredObserver.source !== source) {
      return;
    }
    transientRegisteredObserver.node._registeredObservers.removeTransientRegisteredObserver(
      transientRegisteredObserver
    );
    source.observer._transients.splice(i, 1);
  }
}

// slimdom.js/src/mutation-observer/NotifyList.ts
function queueMicrotaskWithAppropriateApi(callback, thisArg, ...args) {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(() => callback.apply(thisArg, args));
    return;
  }
  Promise.resolve().then(() => callback.apply(thisArg, args));
}
var NotifySet = class {
  constructor() {
    this._notifySet = /* @__PURE__ */ new Set();
    this._mutationObserverMicrotaskQueued = false;
  }
  /**
   * Appends a given MutationRecord to the recordQueue of the given MutationObserver and schedules
   * it for reporting.
   *
   * @param observer - The observer for which to enqueue the record
   * @param record   - The record to enqueue
   */
  appendRecord(observer, record) {
    observer._recordQueue.push(record);
    this._notifySet.add(observer);
  }
  /**
   * To queue a mutation observer microtask, run these steps:
   */
  queueMutationObserverMicrotask() {
    if (this._mutationObserverMicrotaskQueued) {
      return;
    }
    this._mutationObserverMicrotaskQueued = true;
    queueMicrotaskWithAppropriateApi(() => {
      this._notifyMutationObservers();
    }, this);
  }
  /**
   * To notify mutation observers, run these steps:
   */
  _notifyMutationObservers() {
    this._mutationObserverMicrotaskQueued = false;
    const notifySet = Array.from(this._notifySet);
    this._notifySet.clear();
    notifySet.forEach((mo) => {
      queueMicrotaskWithAppropriateApi(
        (mo2) => {
          const records = mo2.takeRecords();
          removeTransientRegisteredObserversForObserver(mo2);
          if (records.length > 0) {
            mo2._callback(records, mo2);
          }
        },
        this,
        mo
      );
    });
  }
};

// slimdom.js/src/context/WeakRef.ts
var FakeWeakRef = class {
  constructor(target) {
    this._target = target;
  }
  deref() {
    return this._target;
  }
};
function createWeakRef(target) {
  if (typeof WeakRef === "function") {
    return new WeakRef(target);
  }
  return new FakeWeakRef(target);
}

// slimdom.js/src/context/Context.ts
var DefaultContext = class {
  constructor() {
    /**
     * The NotifyList instance is shared between all MutationObserver objects. It holds references
     * to all MutationObserver instances that have collected records, and is responsible for
     * invoking their callbacks when control returns to the event loop.
     */
    this._notifySet = new NotifySet();
    this._ranges = [];
    this._weakRangeSet = /* @__PURE__ */ new WeakSet();
  }
  forEachRange(cb) {
    let numRanges = this._ranges.length;
    for (let i = numRanges - 1; i >= 0; --i) {
      const weakref = this._ranges[i];
      const r = weakref.deref();
      const isLost = r === void 0 || r === null;
      const isManuallyRemoved = !isLost && !this._weakRangeSet.has(r);
      if (isLost || isManuallyRemoved) {
        this._ranges[i] = this._ranges[numRanges - 1];
        this._ranges.pop();
        numRanges -= 1;
      } else {
        cb(r);
      }
    }
  }
  addRange(range2) {
    const weakref = createWeakRef(range2);
    this._ranges.push(weakref);
    this._weakRangeSet.add(range2);
  }
  removeRange(range2) {
    this._weakRangeSet.delete(range2);
  }
};
var defaultContext = new DefaultContext();
function getContext(_instance) {
  return defaultContext;
}

// slimdom.js/src/util/NodeType.ts
function isNodeOfType(node, ...types) {
  return types.some((t) => node.nodeType === t);
}
function isAttrNode(node) {
  return node.nodeType === 2 /* ATTRIBUTE_NODE */;
}
function isCharacterDataNode(node) {
  return node.nodeType === 3 /* TEXT_NODE */ || node.nodeType === 4 /* CDATA_SECTION_NODE */ || node.nodeType === 8 /* COMMENT_NODE */ || node.nodeType === 7 /* PROCESSING_INSTRUCTION_NODE */;
}
function isTextNode(node) {
  return node.nodeType === 3 /* TEXT_NODE */ || node.nodeType === 4 /* CDATA_SECTION_NODE */;
}
function isElement(node) {
  return node.nodeType === 1 /* ELEMENT_NODE */;
}
function isDocument(node) {
  return node.nodeType === 9 /* DOCUMENT_NODE */;
}
function isDocumentFragment(node) {
  return node.nodeType === 11 /* DOCUMENT_FRAGMENT_NODE */;
}
function isDocumentType(node) {
  return node.nodeType === 10 /* DOCUMENT_TYPE_NODE */;
}

// slimdom.js/src/util/treeHelpers.ts
function determineLengthOfNode(node) {
  switch (node.nodeType) {
    // DocumentType: Zero.
    // (not necessary, as doctypes never have children)
    // Text, ProcessingInstruction, Comment: The number of code units in its data.
    case 3 /* TEXT_NODE */:
    case 7 /* PROCESSING_INSTRUCTION_NODE */:
    case 8 /* COMMENT_NODE */:
      return node.data.length;
    // Any other node: Its number of children.
    default:
      return node.childNodes.length;
  }
}
function getInclusiveAncestors(node) {
  let ancestor = node;
  let ancestors = [];
  while (ancestor) {
    ancestors.unshift(ancestor);
    ancestor = ancestor.parentNode;
  }
  return ancestors;
}
function getNodeDocument(node) {
  if (isNodeOfType(node, 9 /* DOCUMENT_NODE */)) {
    return node;
  }
  return node.ownerDocument;
}
function getNodeIndex(node) {
  return node.parentNode.childNodes.indexOf(node);
}
function getRootOfNode(node) {
  while (node.parentNode) {
    node = node.parentNode;
  }
  return node;
}
function forEachInclusiveDescendant(node, callback) {
  callback(node);
  for (let child = node.firstChild; child; child = child.nextSibling) {
    forEachInclusiveDescendant(child, callback);
  }
}
function getListOfElementsWithQualifiedName(qualifiedName, root) {
  const elements = [];
  forEachInclusiveDescendant(root, (node) => {
    if (node === root || node.nodeType !== 1 /* ELEMENT_NODE */) {
      return;
    }
    const element2 = node;
    if (
      // 1. If qualifiedName is "*" (U+002A), return a HTMLCollection rooted at root, whose
      // filter matches only descendant elements.
      qualifiedName === "*" || // 2. Otherwise, if root’s node document is an HTML document, return a HTMLCollection
      // rooted at root, whose filter matches the following descendant elements:
      //    - Whose namespace is the HTML namespace and whose qualified name is qualifiedName,
      //      in ASCII lowercase.
      //    - Whose namespace is not the HTML namespace and whose qualified name is
      //      qualifiedName.
      // (html documents not implemented)
      // 3. Otherwise, return a HTMLCollection rooted at root, whose filter matches descendant
      // elements whose qualified name is qualifiedName.
      element2.nodeName === qualifiedName
    ) {
      elements.push(element2);
    }
  });
  return elements;
}
function getListOfElementsWithNamespaceAndLocalName(namespace, localName, root) {
  if (namespace === "") {
    namespace = null;
  }
  const elements = [];
  forEachInclusiveDescendant(root, (node) => {
    if (node === root || node.nodeType !== 1 /* ELEMENT_NODE */) {
      return;
    }
    const element2 = node;
    if (
      // 2. If both namespace and localName are "*" (U+002A), return a HTMLCollection
      //    rooted at root, whose filter matches descendant elements.
      // 3. Otherwise, if namespace is "*" (U+002A), return a HTMLCollection rooted at
      //    root, whose filter matches descendant elements whose local name is localName.
      // 4. Otherwise, if localName is "*" (U+002A), return a HTMLCollection rooted at
      //    root, whose filter matches descendant elements whose namespace is namespace.
      // 5. Otherwise, return a HTMLCollection rooted at root, whose filter matches
      //    descendant elements whose namespace is namespace and local name is localName.
      (namespace === "*" || element2.namespaceURI === namespace) && (localName === "*" || element2.localName === localName)
    ) {
      elements.push(element2);
    }
  });
  return elements;
}

// slimdom.js/src/util/cloneNode.ts
function cloneNode(node, cloneChildren, document3) {
  if (!document3) {
    document3 = getNodeDocument(node);
  }
  let copy = node._copy(document3);
  if (cloneChildren) {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      copy.appendChild(cloneNode(child, true, document3));
    }
  }
  return copy;
}

// slimdom.js/src/util/errorHelpers.ts
function expectArity(args, minArity) {
  if (args.length < minArity) {
    throw new TypeError(`Function should be called with at least ${minArity} arguments`);
  }
}
function expectObject(value, Constructor) {
  if (!(value instanceof Constructor)) {
    throw new TypeError(`Value should be an instance of ${Constructor.name}`);
  }
}
var codeByName = {
  IndexSizeError: 1,
  HierarchyRequestError: 3,
  WrongDocumentError: 4,
  InvalidCharacterError: 5,
  NotFoundError: 8,
  NotSupportedError: 9,
  InUseAttributeError: 10,
  InvalidStateError: 11,
  NamespaceError: 14,
  InvalidNodeTypeError: 24
};
var DOMException = class extends Error {
  constructor(message = "", name = "Error") {
    super(message);
    this.message = message;
    this.name = name;
    this.code = codeByName[name] || 0;
    this.stack = new Error(message).stack;
  }
};
function createDOMException(name, message) {
  return new DOMException(`${name}: ${message}`, name);
}
function throwHierarchyRequestError(message) {
  throw createDOMException("HierarchyRequestError", message);
}
function throwIndexSizeError(message) {
  throw createDOMException("IndexSizeError", message);
}
function throwInUseAttributeError(message) {
  throw createDOMException("InUseAttributeError", message);
}
function throwInvalidCharacterError(message) {
  throw createDOMException("InvalidCharacterError", message);
}
function throwInvalidNodeTypeError(message) {
  throw createDOMException("InvalidNodeTypeError", message);
}
function throwInvalidStateError(message) {
  throw createDOMException("InvalidStateError", message);
}
function throwNamespaceError(message) {
  throw createDOMException("NamespaceError", message);
}
function throwNotFoundError(message) {
  throw createDOMException("NotFoundError", message);
}
function throwNotSupportedError(message) {
  throw createDOMException("NotSupportedError", message);
}
function throwWrongDocumentError(message) {
  throw createDOMException("WrongDocumentError", message);
}

// slimdom.js/src/mutation-observer/MutationRecord.ts
var MutationRecord = class {
  /**
   * (non-standard) Constructs a MutationRecord
   *
   * @param type   - The value for the type property
   * @param target - The value for the target property
   */
  constructor(type, target) {
    /**
     * Children of target added in this mutation.
     *
     * (non-standard) According to the spec this should be a NodeList. This implementation uses an
     * array.
     */
    this.addedNodes = [];
    /**
     * Children of target removed in this mutation.
     *
     * (non-standard) According to the spec this should be a NodeList. This implementation uses an
     * array.
     */
    this.removedNodes = [];
    /**
     * The previous sibling of the added or removed nodes, or null otherwise.
     */
    this.previousSibling = null;
    /**
     * The next sibling Node of the added or removed nodes, or null otherwise.
     */
    this.nextSibling = null;
    /**
     * The local name of the changed attribute, or null otherwise.
     */
    this.attributeName = null;
    /**
     * The namespace of the changed attribute, or null otherwise.
     */
    this.attributeNamespace = null;
    /**
     * The return value depends on type. For "attributes", it is the value of the changed attribute
     * before the change. For "characterData", it is the data of the changed node before the change.
     * For "childList", it is null.
     */
    this.oldValue = null;
    this.type = type;
    this.target = target;
  }
};

// slimdom.js/src/mutation-observer/queueMutationRecord.ts
function queueMutationRecord(type, target, data) {
  const interestedObservers = [];
  const pairedStrings = [];
  for (let node = target; node; node = node.parentNode) {
    node._registeredObservers.collectInterestedObservers(
      type,
      target,
      data,
      interestedObservers,
      pairedStrings
    );
  }
  const context = getContext(target);
  interestedObservers.forEach((observer, index) => {
    const mappedOldValue = pairedStrings[index];
    const record = new MutationRecord(type, target);
    if (data.name !== void 0 && data.namespace !== void 0) {
      record.attributeName = data.name;
      record.attributeNamespace = data.namespace;
    }
    if (mappedOldValue !== void 0) {
      record.oldValue = mappedOldValue;
    }
    if (data.addedNodes !== void 0) {
      record.addedNodes = data.addedNodes;
    }
    if (data.removedNodes !== void 0) {
      record.removedNodes = data.removedNodes;
    }
    if (data.previousSibling !== void 0) {
      record.previousSibling = data.previousSibling;
    }
    if (data.nextSibling !== void 0) {
      record.nextSibling = data.nextSibling;
    }
    context._notifySet.appendRecord(observer, record);
  });
  context._notifySet.queueMutationObserverMicrotask();
}

// slimdom.js/src/mixins.ts
function asParentNode(node) {
  if (isNodeOfType(
    node,
    1 /* ELEMENT_NODE */,
    9 /* DOCUMENT_NODE */,
    11 /* DOCUMENT_FRAGMENT_NODE */
  )) {
    return node;
  }
  return null;
}
function getChildren(node) {
  const elements = [];
  for (let child = node.firstElementChild; child; child = child.nextElementSibling) {
    elements.push(child);
  }
  return elements;
}
function getPreviousElementSibling(node) {
  for (let sibling = node.previousSibling; sibling; sibling = sibling.previousSibling) {
    if (isElement(sibling)) {
      return sibling;
    }
  }
  return null;
}
function getNextElementSibling(node) {
  for (let sibling = node.nextSibling; sibling; sibling = sibling.nextSibling) {
    if (isElement(sibling)) {
      return sibling;
    }
  }
  return null;
}

// slimdom.js/src/util/treeMutations.ts
function insertIntoChildren(node, parent, referenceChild) {
  node.parentNode = parent;
  const previousSibling = referenceChild === null ? parent.lastChild : referenceChild.previousSibling;
  const nextSibling = referenceChild === null ? null : referenceChild;
  node.previousSibling = previousSibling;
  node.nextSibling = nextSibling;
  if (previousSibling) {
    previousSibling.nextSibling = node;
  } else {
    parent.firstChild = node;
  }
  if (nextSibling) {
    nextSibling.previousSibling = node;
    parent.childNodes.splice(parent.childNodes.indexOf(nextSibling), 0, node);
  } else {
    parent.lastChild = node;
    parent.childNodes.push(node);
  }
  if (isElement(node)) {
    const parentNode = parent;
    let previousElementSibling = null;
    for (let sibling = previousSibling; sibling; sibling = sibling.previousSibling) {
      if (isElement(sibling)) {
        previousElementSibling = sibling;
        break;
      }
      const siblingNonDocumentTypeChildNode = sibling;
      if (!isDocumentType(siblingNonDocumentTypeChildNode)) {
        previousElementSibling = siblingNonDocumentTypeChildNode.previousElementSibling;
        break;
      }
    }
    let nextElementSibling = null;
    for (let sibling = nextSibling; sibling; sibling = sibling.nextSibling) {
      if (isElement(sibling)) {
        nextElementSibling = sibling;
        break;
      }
      const siblingNonDocumentTypeChildNode = sibling;
      nextElementSibling = siblingNonDocumentTypeChildNode.nextElementSibling;
      break;
    }
    if (!previousElementSibling) {
      parentNode.firstElementChild = node;
    }
    if (!nextElementSibling) {
      parentNode.lastElementChild = node;
    }
    parentNode.childElementCount += 1;
  }
  if (isDocument(parent)) {
    if (isElement(node)) {
      parent.documentElement = node;
    } else if (isDocumentType(node)) {
      parent.doctype = node;
    }
  }
}
function removeFromChildren(node, parent) {
  const previousSibling = node.previousSibling;
  const nextSibling = node.nextSibling;
  const isElement2 = isNodeOfType(node, 1 /* ELEMENT_NODE */);
  const previousElementSibling = isElement2 ? node.previousElementSibling : null;
  const nextElementSibling = isElement2 ? node.nextElementSibling : null;
  node.parentNode = null;
  node.previousSibling = null;
  node.nextSibling = null;
  if (previousSibling) {
    previousSibling.nextSibling = nextSibling;
  } else {
    parent.firstChild = nextSibling;
  }
  if (nextSibling) {
    nextSibling.previousSibling = previousSibling;
  } else {
    parent.lastChild = previousSibling;
  }
  parent.childNodes.splice(parent.childNodes.indexOf(node), 1);
  if (isElement2) {
    const parentNode = asParentNode(parent);
    if (parentNode) {
      if (parentNode.firstElementChild === node) {
        parentNode.firstElementChild = nextElementSibling;
      }
      if (parentNode.lastElementChild === node) {
        parentNode.lastElementChild = previousElementSibling;
      }
      parentNode.childElementCount -= 1;
    }
  }
  if (isNodeOfType(parent, 9 /* DOCUMENT_NODE */)) {
    const parentDocument = parent;
    if (isNodeOfType(node, 1 /* ELEMENT_NODE */)) {
      parentDocument.documentElement = null;
    } else if (isNodeOfType(node, 10 /* DOCUMENT_TYPE_NODE */)) {
      parentDocument.doctype = null;
    }
  }
}

// slimdom.js/src/util/mutationAlgorithms.ts
function ensurePreInsertionValidity(node, parent, child) {
  if (!isNodeOfType(
    parent,
    9 /* DOCUMENT_NODE */,
    11 /* DOCUMENT_FRAGMENT_NODE */,
    1 /* ELEMENT_NODE */
  )) {
    throwHierarchyRequestError("parent must be a Document, DocumentFragment or Element node");
  }
  if (node.contains(parent)) {
    throwHierarchyRequestError("node must not be an inclusive ancestor of parent");
  }
  if (child && child.parentNode !== parent) {
    throwNotFoundError("child is not a child of parent");
  }
  if (!isNodeOfType(
    node,
    11 /* DOCUMENT_FRAGMENT_NODE */,
    10 /* DOCUMENT_TYPE_NODE */,
    1 /* ELEMENT_NODE */,
    3 /* TEXT_NODE */,
    4 /* CDATA_SECTION_NODE */,
    7 /* PROCESSING_INSTRUCTION_NODE */,
    8 /* COMMENT_NODE */
  )) {
    throwHierarchyRequestError(
      "node must be a DocumentFragment, DocumentType, Element, Text, ProcessingInstruction or Comment node"
    );
  }
  if (isNodeOfType(node, 3 /* TEXT_NODE */) && isNodeOfType(parent, 9 /* DOCUMENT_NODE */)) {
    throwHierarchyRequestError("can not insert a Text node under a Document");
  }
  if (isNodeOfType(node, 10 /* DOCUMENT_TYPE_NODE */) && !isNodeOfType(parent, 9 /* DOCUMENT_NODE */)) {
    throwHierarchyRequestError("can only insert a DocumentType node under a Document");
  }
  if (isNodeOfType(parent, 9 /* DOCUMENT_NODE */)) {
    const parentDocument = parent;
    switch (node.nodeType) {
      // DocumentFragment node
      case 11 /* DOCUMENT_FRAGMENT_NODE */:
        const fragment = node;
        if (fragment.firstElementChild !== fragment.lastElementChild) {
          throwHierarchyRequestError(
            "can not insert more than one element under a Document"
          );
        }
        if (Array.from(fragment.childNodes).some(
          (child2) => isNodeOfType(child2, 3 /* TEXT_NODE */)
        )) {
          throwHierarchyRequestError("can not insert a Text node under a Document");
        }
        if (fragment.firstElementChild && (parentDocument.documentElement || child && isNodeOfType(child, 10 /* DOCUMENT_TYPE_NODE */) || child && parentDocument.doctype && getNodeIndex(child) < getNodeIndex(parentDocument.doctype))) {
          throwHierarchyRequestError(
            "Document should contain at most one doctype, followed by at most one element"
          );
        }
        break;
      // element
      case 1 /* ELEMENT_NODE */:
        if (parentDocument.documentElement || child && isNodeOfType(child, 10 /* DOCUMENT_TYPE_NODE */) || child && parentDocument.doctype && getNodeIndex(child) < getNodeIndex(parentDocument.doctype)) {
          throwHierarchyRequestError(
            "Document should contain at most one doctype, followed by at most one element"
          );
        }
        break;
      // doctype
      case 10 /* DOCUMENT_TYPE_NODE */:
        if (parentDocument.doctype || child && parentDocument.documentElement && getNodeIndex(parentDocument.documentElement) < getNodeIndex(child) || !child && parentDocument.documentElement) {
          throwHierarchyRequestError(
            "Document should contain at most one doctype, followed by at most one element"
          );
        }
        break;
    }
  }
}
function preInsertNode(node, parent, child) {
  ensurePreInsertionValidity(node, parent, child);
  let referenceChild = child;
  if (referenceChild === node) {
    referenceChild = node.nextSibling;
  }
  adoptNode(node, getNodeDocument(parent));
  insertNode(node, parent, referenceChild);
  return node;
}
function insertNode(node, parent, child, suppressObservers = false) {
  const isFragment = isDocumentFragment(node);
  const nodes = isFragment ? Array.from(node.childNodes) : [node];
  const count = nodes.length;
  if (count === 0) {
    return;
  }
  if (isFragment) {
    nodes.forEach((n) => removeNode(n, true));
    queueMutationRecord("childList", node, {
      removedNodes: nodes
    });
  }
  if (child !== null) {
    const childIndex = getNodeIndex(child);
    const context = getContext(node);
    context.forEachRange((range2) => {
      if (range2.startContainer === parent && range2.startOffset > childIndex) {
        range2.startOffset += count;
      }
      if (range2.endContainer === parent && range2.endOffset > childIndex) {
        range2.endOffset += count;
      }
    });
  }
  let previousSibling = child === null ? parent.lastChild : child.previousSibling;
  nodes.forEach((node2) => {
    insertIntoChildren(node2, parent, child);
  });
  if (!suppressObservers) {
    queueMutationRecord("childList", parent, {
      addedNodes: nodes,
      nextSibling: child,
      previousSibling
    });
  }
}
function appendNode(node, parent) {
  return preInsertNode(node, parent, null);
}
function replaceChildWithNode(child, node, parent) {
  if (!isNodeOfType(
    parent,
    9 /* DOCUMENT_NODE */,
    11 /* DOCUMENT_FRAGMENT_NODE */,
    1 /* ELEMENT_NODE */
  )) {
    throwHierarchyRequestError("Can not replace under a non-parent node");
  }
  if (node.contains(parent)) {
    throwHierarchyRequestError("Can not insert a node under its own descendant");
  }
  if (child.parentNode !== parent) {
    throwNotFoundError("child is not a child of parent");
  }
  if (!isNodeOfType(
    node,
    11 /* DOCUMENT_FRAGMENT_NODE */,
    10 /* DOCUMENT_TYPE_NODE */,
    1 /* ELEMENT_NODE */,
    3 /* TEXT_NODE */,
    4 /* CDATA_SECTION_NODE */,
    7 /* PROCESSING_INSTRUCTION_NODE */,
    8 /* COMMENT_NODE */
  )) {
    throwHierarchyRequestError(
      "Can not insert a node that isn't a DocumentFragment, DocumentType, Element, Text, ProcessingInstruction or Comment"
    );
  }
  if (isNodeOfType(node, 3 /* TEXT_NODE */) && isNodeOfType(parent, 9 /* DOCUMENT_NODE */)) {
    throwHierarchyRequestError("can not insert a Text node under a Document");
  }
  if (isNodeOfType(node, 10 /* DOCUMENT_TYPE_NODE */) && !isNodeOfType(parent, 9 /* DOCUMENT_NODE */)) {
    throwHierarchyRequestError("can only insert a DocumentType node under a Document");
  }
  if (isNodeOfType(parent, 9 /* DOCUMENT_NODE */)) {
    const parentDocument = parent;
    switch (node.nodeType) {
      // DocumentFragment node
      case 11 /* DOCUMENT_FRAGMENT_NODE */:
        const fragment = node;
        if (fragment.firstElementChild !== fragment.lastElementChild) {
          throwHierarchyRequestError(
            "can not insert more than one element under a Document"
          );
        }
        if (Array.from(fragment.childNodes).some(
          (child2) => isNodeOfType(child2, 3 /* TEXT_NODE */)
        )) {
          throwHierarchyRequestError("can not insert a Text node under a Document");
        }
        if (fragment.firstElementChild && (parentDocument.documentElement && parentDocument.documentElement !== child || child && parentDocument.doctype && getNodeIndex(child) < getNodeIndex(parentDocument.doctype))) {
          throwHierarchyRequestError(
            "Document should contain at most one doctype, followed by at most one element"
          );
        }
        break;
      // element
      case 1 /* ELEMENT_NODE */:
        if (parentDocument.documentElement && parentDocument.documentElement !== child || parentDocument.doctype && getNodeIndex(child) < getNodeIndex(parentDocument.doctype)) {
          throwHierarchyRequestError(
            "Document should contain at most one doctype, followed by at most one element"
          );
        }
        break;
      // doctype
      case 10 /* DOCUMENT_TYPE_NODE */:
        if (parentDocument.doctype && parentDocument.doctype !== child || parentDocument.documentElement && getNodeIndex(parentDocument.documentElement) < getNodeIndex(child)) {
          throwHierarchyRequestError(
            "Document should contain at most one doctype, followed by at most one element"
          );
        }
        break;
    }
  }
  let referenceChild = child.nextSibling;
  if (referenceChild === node) {
    referenceChild = node.nextSibling;
  }
  const previousSibling = child.previousSibling;
  adoptNode(node, getNodeDocument(parent));
  let removedNodes = [];
  if (child.parentNode !== null) {
    removedNodes.push(child);
    removeNode(child, true);
  }
  const nodes = isNodeOfType(node, 11 /* DOCUMENT_FRAGMENT_NODE */) ? Array.from(node.childNodes) : [node];
  insertNode(node, parent, referenceChild, true);
  queueMutationRecord("childList", parent, {
    addedNodes: nodes,
    removedNodes,
    nextSibling: referenceChild,
    previousSibling
  });
  return child;
}
function replaceAllWithNode(node, parent) {
  if (node !== null) {
    adoptNode(node, getNodeDocument(parent));
  }
  const removedNodes = Array.from(parent.childNodes);
  let addedNodes = [];
  if (node !== null) {
    if (isNodeOfType(node, 11 /* DOCUMENT_FRAGMENT_NODE */)) {
      node.childNodes.forEach((child) => {
        addedNodes.push(child);
      });
    } else {
      addedNodes.push(node);
    }
  }
  removedNodes.forEach((child) => {
    removeNode(child, true);
  });
  if (node !== null) {
    insertNode(node, parent, null, true);
  }
  if (addedNodes.length > 0 || removedNodes.length > 0) {
    queueMutationRecord("childList", parent, {
      addedNodes,
      removedNodes
    });
  }
}
function preRemoveChild(child, parent) {
  if (child.parentNode !== parent) {
    throwNotFoundError("child is not a child of parent");
  }
  removeNode(child);
  return child;
}
function removeNode(node, suppressObservers = false) {
  const parent = node.parentNode;
  const index = getNodeIndex(node);
  const context = getContext(node);
  context.forEachRange((range2) => {
    if (node.contains(range2.startContainer)) {
      range2.startContainer = parent;
      range2.startOffset = index;
    }
    if (node.contains(range2.endContainer)) {
      range2.endContainer = parent;
      range2.endOffset = index;
    }
    if (range2.startContainer === parent && range2.startOffset > index) {
      range2.startOffset -= 1;
    }
    if (range2.endContainer === parent && range2.endOffset > index) {
      range2.endOffset -= 1;
    }
  });
  const oldPreviousSibling = node.previousSibling;
  const oldNextSibling = node.nextSibling;
  removeFromChildren(node, parent);
  for (let inclusiveAncestor = parent; inclusiveAncestor; inclusiveAncestor = inclusiveAncestor.parentNode) {
    inclusiveAncestor._registeredObservers.appendTransientRegisteredObservers(node);
  }
  if (!suppressObservers) {
    queueMutationRecord("childList", parent, {
      removedNodes: [node],
      nextSibling: oldNextSibling,
      previousSibling: oldPreviousSibling
    });
  }
}
function adoptNode(node, document3) {
  const oldDocument = getNodeDocument(node);
  if (node.parentNode) {
    removeNode(node);
  }
  if (document3 === oldDocument) {
    return;
  }
  forEachInclusiveDescendant(node, (inclusiveDescendant) => {
    inclusiveDescendant.ownerDocument = document3;
    if (isNodeOfType(inclusiveDescendant, 1 /* ELEMENT_NODE */)) {
      for (const attr of inclusiveDescendant.attributes) {
        attr.ownerDocument = document3;
      }
    }
  });
}
function getDescendantTextContent(node) {
  const data = [];
  forEachInclusiveDescendant(node, (descendant) => {
    if (!isNodeOfType(descendant, 3 /* TEXT_NODE */, 4 /* CDATA_SECTION_NODE */)) {
      return;
    }
    data.push(descendant.data);
  });
  return data.join("");
}
function stringReplaceAll(parent, newValue) {
  let node = null;
  if (newValue !== "") {
    const context = getContext(parent);
    node = new context.Text(newValue);
  }
  replaceAllWithNode(node, parent);
}
function convertNodesIntoNode(nodes, document3) {
  const actualNodes = nodes.map((nodeOrString) => {
    if (nodeOrString instanceof Node) {
      return nodeOrString;
    }
    return document3.createTextNode(String(nodeOrString));
  });
  if (actualNodes.length === 1) {
    return actualNodes[0];
  } else {
    const node = document3.createDocumentFragment();
    actualNodes.forEach((child) => {
      node.appendChild(child);
    });
    return node;
  }
}
function prependNodes(thisObject, nodes) {
  const node = convertNodesIntoNode(nodes, getNodeDocument(thisObject));
  preInsertNode(node, thisObject, thisObject.firstChild);
}
function appendNodes(thisObject, nodes) {
  const node = convertNodesIntoNode(nodes, getNodeDocument(thisObject));
  appendNode(node, thisObject);
}
function replaceChildren(thisObject, nodes) {
  const node = convertNodesIntoNode(nodes, getNodeDocument(thisObject));
  ensurePreInsertionValidity(node, thisObject, null);
  replaceAllWithNode(node, thisObject);
}
function insertNodesBefore(thisObject, nodes) {
  const parent = thisObject.parentNode;
  if (parent === null) {
    return;
  }
  let viablePreviousSibling = thisObject.previousSibling;
  while (viablePreviousSibling !== null && nodes.indexOf(viablePreviousSibling) >= 0) {
    viablePreviousSibling = viablePreviousSibling.previousSibling;
  }
  const node = convertNodesIntoNode(nodes, getNodeDocument(thisObject));
  const referenceNode = viablePreviousSibling === null ? parent.firstChild : viablePreviousSibling.nextSibling;
  preInsertNode(node, parent, referenceNode);
}
function insertNodesAfter(thisObject, nodes) {
  const parent = thisObject.parentNode;
  if (parent === null) {
    return;
  }
  let viableNextSibling = thisObject.nextSibling;
  while (viableNextSibling !== null && nodes.indexOf(viableNextSibling) >= 0) {
    viableNextSibling = viableNextSibling.nextSibling;
  }
  const node = convertNodesIntoNode(nodes, getNodeDocument(thisObject));
  preInsertNode(node, parent, viableNextSibling);
}
function replaceWithNodes(thisObject, nodes) {
  const parent = thisObject.parentNode;
  if (parent === null) {
    return;
  }
  let viableNextSibling = thisObject.nextSibling;
  while (viableNextSibling !== null && nodes.indexOf(viableNextSibling) >= 0) {
    viableNextSibling = viableNextSibling.nextSibling;
  }
  const node = convertNodesIntoNode(nodes, getNodeDocument(thisObject));
  if (thisObject.parentNode === parent) {
    replaceChildWithNode(thisObject, node, parent);
  } else {
    preInsertNode(node, parent, viableNextSibling);
  }
}
function removeFromParent(thisObject) {
  if (thisObject.parentNode === null) {
    return;
  }
  removeNode(thisObject);
}
function insertNodeIntoRange(node, range2) {
  const startContainer = range2.startContainer;
  if (isNodeOfType(startContainer, 7 /* PROCESSING_INSTRUCTION_NODE */)) {
    throwHierarchyRequestError("Can not insert into a processing instruction");
  }
  if (isNodeOfType(startContainer, 8 /* COMMENT_NODE */)) {
    throwHierarchyRequestError("Can not insert into a comment");
  }
  if (isTextNode(startContainer) && startContainer.parentNode === null) {
    throwHierarchyRequestError("Can not insert into a text node without a parent");
  }
  let referenceNode = null;
  if (isTextNode(startContainer)) {
    referenceNode = startContainer;
  } else {
    referenceNode = startContainer.childNodes[range2.startOffset] || null;
  }
  const parent = referenceNode === null ? startContainer : referenceNode.parentNode;
  ensurePreInsertionValidity(node, parent, referenceNode);
  if (isTextNode(startContainer)) {
    referenceNode = startContainer.splitText(range2.startOffset);
  }
  if (node === referenceNode) {
    referenceNode = referenceNode.nextSibling;
  }
  if (node.parentNode !== null) {
    removeNode(node);
  }
  let newOffset = referenceNode === null ? determineLengthOfNode(parent) : getNodeIndex(referenceNode);
  if (isNodeOfType(node, 11 /* DOCUMENT_FRAGMENT_NODE */)) {
    newOffset += determineLengthOfNode(node);
  } else {
    newOffset += 1;
  }
  preInsertNode(node, parent, referenceNode);
  if (range2.collapsed) {
    range2.setEnd(parent, newOffset);
  }
}

// slimdom.js/src/util/typeHelpers.ts
function asUnsignedLong(number) {
  return number >>> 0;
}
function legacyNullToEmptyString(value) {
  if (value === null) {
    return "";
  }
  return String(value);
}
function ifNullActAsIfEmptyString(value) {
  if (value === void 0 || value === null) {
    return "";
  }
  return String(value);
}
function asObject(value, Constructor) {
  expectObject(value, Constructor);
  return value;
}
function asNullableObject(value, Constructor) {
  if (value === void 0 || value === null) {
    return null;
  }
  return asObject(value, Constructor);
}
function asNullableString(value) {
  if (value === void 0) {
    return null;
  }
  return value;
}

// slimdom.js/src/Node.ts
var orderKeyByNode = /* @__PURE__ */ new WeakMap();
function getOrderKey(node) {
  let orderKey = orderKeyByNode.get(node);
  if (orderKey === void 0) {
    orderKey = Math.random();
    orderKeyByNode.set(node, orderKey);
  }
  return orderKey;
}
var _Node = class _Node {
  constructor() {
    /**
     * A reference to the Document node in which the current node resides.
     */
    this.ownerDocument = null;
    /**
     * The parent node of the current node.
     */
    this.parentNode = null;
    /**
     * The node's children.
     *
     * Non-standard: implemented as an array rather than a NodeList.
     */
    this.childNodes = [];
    /**
     * The first child node of the current node, or null if it has no children.
     */
    this.firstChild = null;
    /**
     * The last child node of the current node, or null if it has no children.
     */
    this.lastChild = null;
    /**
     * The first preceding sibling of the current node, or null if it has none.
     */
    this.previousSibling = null;
    /**
     * The first following sibling of the current node, or null if it has none.
     */
    this.nextSibling = null;
    /**
     * (non-standard)
     * Each node has a registered observer list of zero or more registered observers, which is
     * initially empty.
     */
    this._registeredObservers = new RegisteredObservers(this);
  }
  /**
   * The parent if it is an element, or null otherwise.
   */
  get parentElement() {
    return this.parentNode && isNodeOfType(this.parentNode, 1 /* ELEMENT_NODE */) ? this.parentNode : null;
  }
  /**
   * Returns true if this has children, and false otherwise.
   */
  hasChildNodes() {
    return !!this.childNodes.length;
  }
  /**
   * Puts the specified node and all of its subtree into a "normalized" form. In a normalized
   * subtree, no text nodes in the subtree are empty and there are no adjacent text nodes.
   */
  normalize() {
    let node = this.firstChild;
    let index = 0;
    const document3 = getNodeDocument(this);
    while (node) {
      let nextNode = node.nextSibling;
      if (!isNodeOfType(node, 3 /* TEXT_NODE */)) {
        node.normalize();
        node = nextNode;
        continue;
      }
      const textNode = node;
      let length = textNode.length;
      if (length === 0) {
        removeNode(node);
        --index;
        node = nextNode;
        continue;
      }
      let data = "";
      const siblingsToRemove = [];
      for (let sibling = textNode.nextSibling; sibling && isNodeOfType(sibling, 3 /* TEXT_NODE */); sibling = sibling.nextSibling) {
        data += sibling.data;
        siblingsToRemove.push(sibling);
      }
      if (data) {
        textNode.replaceData(length, 0, data);
      }
      const context = getContext(this);
      for (let i = 0, l = siblingsToRemove.length; i < l; ++i) {
        const currentNode = siblingsToRemove[i];
        const currentNodeIndex = index + i + 1;
        context.forEachRange((range2) => {
          if (range2.startContainer === currentNode) {
            range2.startOffset += length;
            range2.startContainer = textNode;
          }
          if (range2.endContainer === currentNode) {
            range2.endOffset += length;
            range2.endContainer = textNode;
          }
          if (range2.startContainer === this && range2.startOffset === currentNodeIndex) {
            range2.startContainer = textNode;
            range2.startOffset = length;
          }
          if (range2.endContainer === this && range2.endOffset === currentNodeIndex) {
            range2.endContainer = textNode;
            range2.endOffset = length;
          }
        });
        length += currentNode.length;
      }
      while (siblingsToRemove.length) {
        removeNode(siblingsToRemove.shift());
      }
      node = node.nextSibling;
      ++index;
    }
  }
  /**
   * Returns a copy of the current node.
   *
   * @param deep - Whether to also clone the node's descendants
   *
   * @returns A copy of the current node
   */
  cloneNode(deep = false) {
    return cloneNode(this, deep);
  }
  /**
   * Compare the position of this node with the given one.
   *
   * @param other - Node to compare with
   *
   * @returns a combination of the DOCUMENT_POSITION_* flags
   */
  compareDocumentPosition(other) {
    expectArity(arguments, 1);
    other = asObject(other, _Node);
    if (this === other) {
      return 0;
    }
    let node1 = other;
    let node2 = this;
    let attr1 = null;
    let attr2 = null;
    if (isAttrNode(node1)) {
      attr1 = node1;
      node1 = attr1.ownerElement;
    }
    if (isAttrNode(node2)) {
      attr2 = node2;
      node2 = attr2.ownerElement;
      if (attr1 !== null && node1 !== null && node2 === node1) {
        for (const attr of node2.attributes) {
          if (attr === attr1) {
            return _Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC | _Node.DOCUMENT_POSITION_PRECEDING;
          }
          if (attr === attr2) {
            return _Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC | _Node.DOCUMENT_POSITION_FOLLOWING;
          }
        }
      }
    }
    if (node1 === null || node2 === null) {
      return _Node.DOCUMENT_POSITION_DISCONNECTED | _Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC | (getOrderKey(node1 || attr1) > getOrderKey(node2 || attr2) ? _Node.DOCUMENT_POSITION_FOLLOWING : _Node.DOCUMENT_POSITION_PRECEDING);
    }
    const ancestors1 = getInclusiveAncestors(node1);
    const ancestors2 = getInclusiveAncestors(node2);
    if (ancestors1[0] !== ancestors2[0]) {
      return _Node.DOCUMENT_POSITION_DISCONNECTED | _Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC | (getOrderKey(ancestors1[0]) > getOrderKey(ancestors2[0]) ? _Node.DOCUMENT_POSITION_FOLLOWING : _Node.DOCUMENT_POSITION_PRECEDING);
    }
    let firstDistinctAncestorIndex = 0;
    while (firstDistinctAncestorIndex < ancestors1.length && firstDistinctAncestorIndex < ancestors2.length) {
      if (ancestors1[firstDistinctAncestorIndex] !== ancestors2[firstDistinctAncestorIndex]) {
        break;
      }
      ++firstDistinctAncestorIndex;
    }
    const node1ContainsNode2 = node1 !== node2 && firstDistinctAncestorIndex === ancestors1.length;
    const node2ContainsNode1 = node1 !== node2 && firstDistinctAncestorIndex === ancestors2.length;
    if (node1ContainsNode2 && attr1 === null || node1 === node2 && attr2 !== null) {
      return _Node.DOCUMENT_POSITION_CONTAINS | _Node.DOCUMENT_POSITION_PRECEDING;
    }
    if (node2ContainsNode1 && attr2 === null || node1 === node2 && attr1 !== null) {
      return _Node.DOCUMENT_POSITION_CONTAINED_BY | _Node.DOCUMENT_POSITION_FOLLOWING;
    }
    if (node1ContainsNode2 || getNodeIndex(ancestors1[firstDistinctAncestorIndex]) < getNodeIndex(ancestors2[firstDistinctAncestorIndex])) {
      return _Node.DOCUMENT_POSITION_PRECEDING;
    }
    return _Node.DOCUMENT_POSITION_FOLLOWING;
  }
  /**
   * Returns true if other is an inclusive descendant of this, and false otherwise
   * (including when other is null).
   *
   * @param childNode - Node to check
   *
   * @returns Whether childNode is an inclusive descendant of the current node
   */
  contains(other) {
    expectArity(arguments, 1);
    other = asNullableObject(other, _Node);
    while (other && other != this) {
      other = other.parentNode;
    }
    return other === this;
  }
  /**
   * Return true if defaultNamespace is the same as namespace, and false otherwise.
   *
   * @param namespace - The namespace to check
   *
   * @returns Whether namespace is the default namespace
   */
  isDefaultNamespace(namespace) {
    expectArity(arguments, 1);
    namespace = asNullableString(namespace);
    if (namespace === "") {
      namespace = null;
    }
    const defaultNamespace = this.lookupNamespaceURI(null);
    return defaultNamespace === namespace;
  }
  /**
   * Inserts the specified node before child within this.
   *
   * If child is null, the new node is appended after the last child node of the current node.
   *
   * @param node  - Node to insert
   * @param child - Childnode of the current node before which to insert, or null to append
   *                newNode at the end
   *
   * @returns The node that was inserted
   */
  insertBefore(node, child) {
    expectArity(arguments, 2);
    node = asObject(node, _Node);
    child = asNullableObject(child, _Node);
    return preInsertNode(node, this, child);
  }
  /**
   * Adds node to the end of the list of children of this.
   *
   * If the node already exists it is removed from its current parent node, then added.
   *
   * @param node - Node to append
   *
   * @returns The node that was inserted
   */
  appendChild(node) {
    expectArity(arguments, 1);
    node = asObject(node, _Node);
    return appendNode(node, this);
  }
  /**
   * Replaces child with node within this and returns child.
   *
   * @param node  - Node to insert
   * @param child - Node to remove
   *
   * @returns The node that was removed
   */
  replaceChild(node, child) {
    expectArity(arguments, 2);
    node = asObject(node, _Node);
    child = asObject(child, _Node);
    return replaceChildWithNode(child, node, this);
  }
  /**
   * Removes child from this and returns the removed node.
   *
   * @param child - Child of the current node to remove
   *
   * @returns The node that was removed
   */
  removeChild(child) {
    expectArity(arguments, 1);
    child = asObject(child, _Node);
    return preRemoveChild(child, this);
  }
};
// Node types are exposed as properties of the constructor
_Node.ELEMENT_NODE = 1 /* ELEMENT_NODE */;
_Node.ATTRIBUTE_NODE = 2 /* ATTRIBUTE_NODE */;
_Node.TEXT_NODE = 3 /* TEXT_NODE */;
_Node.CDATA_SECTION_NODE = 4 /* CDATA_SECTION_NODE */;
_Node.ENTITY_REFERENCE_NODE = 5 /* ENTITY_REFERENCE_NODE */;
// legacy
_Node.ENTITY_NODE = 6 /* ENTITY_NODE */;
// legacy
_Node.PROCESSING_INSTRUCTION_NODE = 7 /* PROCESSING_INSTRUCTION_NODE */;
_Node.COMMENT_NODE = 8 /* COMMENT_NODE */;
_Node.DOCUMENT_NODE = 9 /* DOCUMENT_NODE */;
_Node.DOCUMENT_TYPE_NODE = 10 /* DOCUMENT_TYPE_NODE */;
_Node.DOCUMENT_FRAGMENT_NODE = 11 /* DOCUMENT_FRAGMENT_NODE */;
_Node.NOTATION_NODE = 12 /* NOTATION_NODE */;
_Node.DOCUMENT_POSITION_DISCONNECTED = 1;
_Node.DOCUMENT_POSITION_PRECEDING = 2;
_Node.DOCUMENT_POSITION_FOLLOWING = 4;
_Node.DOCUMENT_POSITION_CONTAINS = 8;
_Node.DOCUMENT_POSITION_CONTAINED_BY = 16;
_Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC = 32;
var Node = _Node;
Node.prototype.ELEMENT_NODE = 1 /* ELEMENT_NODE */;
Node.prototype.ATTRIBUTE_NODE = 2 /* ATTRIBUTE_NODE */;
Node.prototype.TEXT_NODE = 3 /* TEXT_NODE */;
Node.prototype.CDATA_SECTION_NODE = 4 /* CDATA_SECTION_NODE */;
Node.prototype.ENTITY_REFERENCE_NODE = 5 /* ENTITY_REFERENCE_NODE */;
Node.prototype.ENTITY_NODE = 6 /* ENTITY_NODE */;
Node.prototype.PROCESSING_INSTRUCTION_NODE = 7 /* PROCESSING_INSTRUCTION_NODE */;
Node.prototype.COMMENT_NODE = 8 /* COMMENT_NODE */;
Node.prototype.DOCUMENT_NODE = 9 /* DOCUMENT_NODE */;
Node.prototype.DOCUMENT_TYPE_NODE = 10 /* DOCUMENT_TYPE_NODE */;
Node.prototype.DOCUMENT_FRAGMENT_NODE = 11 /* DOCUMENT_FRAGMENT_NODE */;
Node.prototype.NOTATION_NODE = 12 /* NOTATION_NODE */;

// slimdom.js/src/util/attrMutations.ts
function handleAttributeChanges(attribute, element2, oldValue, newValue) {
  queueMutationRecord("attributes", element2, {
    name: attribute.localName,
    namespace: attribute.namespaceURI,
    oldValue
  });
}
function changeAttribute(attribute, value) {
  handleAttributeChanges(attribute, attribute.ownerElement, attribute.value, value);
  attribute._value = value;
}
function appendAttribute(attribute, element2, suppressObservers = false) {
  if (!suppressObservers) {
    handleAttributeChanges(attribute, element2, null, attribute.value);
  }
  element2.attributes.push(attribute);
  attribute.ownerElement = element2;
}
function removeAttribute(attribute) {
  const attributeElement = attribute.ownerElement;
  handleAttributeChanges(attribute, attributeElement, attribute.value, null);
  attributeElement.attributes.splice(attributeElement.attributes.indexOf(attribute), 1);
  attribute.ownerElement = null;
}
function replaceAttribute(oldAttr, newAttr) {
  const oldAttrElement = oldAttr.ownerElement;
  handleAttributeChanges(oldAttr, oldAttrElement, oldAttr.value, newAttr.value);
  oldAttrElement.attributes.splice(oldAttrElement.attributes.indexOf(oldAttr), 1, newAttr);
  newAttr.ownerElement = oldAttrElement;
  oldAttr.ownerElement = null;
}

// slimdom.js/src/Attr.ts
var Attr = class extends Node {
  // Node
  get nodeType() {
    return 2 /* ATTRIBUTE_NODE */;
  }
  get nodeName() {
    return this.name;
  }
  get nodeValue() {
    return this._value;
  }
  set nodeValue(newValue) {
    newValue = ifNullActAsIfEmptyString(newValue);
    setExistingAttributeValue(this, newValue);
  }
  get textContent() {
    return this._value;
  }
  set textContent(newValue) {
    newValue = ifNullActAsIfEmptyString(newValue);
    setExistingAttributeValue(this, newValue);
  }
  lookupPrefix(namespace) {
    expectArity(arguments, 1);
    if (this.ownerElement !== null) {
      return this.ownerElement.lookupPrefix(namespace);
    }
    return null;
  }
  lookupNamespaceURI(prefix) {
    expectArity(arguments, 1);
    if (this.ownerElement === null) {
      return null;
    }
    return this.ownerElement.lookupNamespaceURI(prefix);
  }
  get value() {
    return this._value;
  }
  set value(value) {
    setExistingAttributeValue(this, value);
  }
  /**
   * (non-standard) use Document#createAttribute(NS) or Element#setAttribute(NS) to create
   * attribute nodes
   *
   * @param namespace - The namespace URI for the attribute
   * @param prefix    - The prefix for the attribute
   * @param localName - The local name for the attribute
   * @param value     - The value for the attribute
   * @param element   - The element for the attribute, or null if the attribute is not attached to
   *                    an element
   */
  constructor(namespace, prefix, localName, value, element2) {
    super();
    this.namespaceURI = namespace;
    this.prefix = prefix;
    this.localName = localName;
    this.name = prefix === null ? localName : `${prefix}:${localName}`;
    this._value = value;
    this.ownerElement = element2;
    this.ownerDocument = element2 ? element2.ownerDocument : getContext(this).document;
  }
  /**
   * (non-standard) Creates a copy of this, not including its children.
   *
   * @param document - The node document to associate with the copy
   *
   * @returns A shallow copy of this
   */
  _copy(document3) {
    const context = getContext(document3);
    const copy = new context.Attr(
      this.namespaceURI,
      this.prefix,
      this.localName,
      this.value,
      null
    );
    copy.ownerDocument = document3;
    return copy;
  }
};
function setExistingAttributeValue(attribute, value) {
  value = String(value);
  const element2 = attribute.ownerElement;
  if (element2 === null) {
    attribute._value = value;
  } else {
    changeAttribute(attribute, value);
  }
}

// slimdom.js/src/CharacterData.ts
var CharacterData = class extends Node {
  // Node
  get nodeValue() {
    return this._data;
  }
  set nodeValue(newValue) {
    newValue = ifNullActAsIfEmptyString(newValue);
    replaceData(this, 0, this.length, newValue);
  }
  get textContent() {
    return this._data;
  }
  set textContent(newValue) {
    newValue = ifNullActAsIfEmptyString(newValue);
    replaceData(this, 0, this.length, newValue);
  }
  lookupPrefix(namespace) {
    expectArity(arguments, 1);
    const parentElement = this.parentElement;
    if (parentElement !== null) {
      return parentElement.lookupPrefix(namespace);
    }
    return null;
  }
  lookupNamespaceURI(prefix) {
    expectArity(arguments, 1);
    const parentElement = this.parentElement;
    if (parentElement === null) {
      return null;
    }
    return parentElement.lookupNamespaceURI(prefix);
  }
  // ChildNode
  before(...nodes) {
    insertNodesBefore(this, nodes);
  }
  after(...nodes) {
    insertNodesAfter(this, nodes);
  }
  replaceWith(...nodes) {
    replaceWithNodes(this, nodes);
  }
  remove() {
    removeFromParent(this);
  }
  // NonDocumentTypeChildNode
  get previousElementSibling() {
    return getPreviousElementSibling(this);
  }
  get nextElementSibling() {
    return getNextElementSibling(this);
  }
  get data() {
    return this._data;
  }
  set data(newValue) {
    newValue = legacyNullToEmptyString(newValue);
    replaceData(this, 0, this.length, newValue);
  }
  get length() {
    return this.data.length;
  }
  /**
   * (non-standard) CharacterData should never be instantiated directly.
   *
   * @param data - The data to associate with the node
   */
  constructor(data) {
    super();
    this._data = String(data);
  }
  /**
   * Returns a substring of the node's data.
   *
   * @param offset - Offset at which to start the substring
   * @param count  - The number of code units to return
   *
   * @returns The specified substring
   */
  substringData(offset, count) {
    expectArity(arguments, 2);
    return substringData(this, offset, count);
  }
  /**
   * Appends data to the node's data.
   *
   * @param data - Data to append
   */
  appendData(data) {
    expectArity(arguments, 1);
    replaceData(this, this.length, 0, data);
  }
  /**
   * Inserts data at the specified position in the node's data.
   *
   * @param offset - Offset at which to insert
   * @param data   - Data to insert
   */
  insertData(offset, data) {
    expectArity(arguments, 1);
    replaceData(this, offset, 0, data);
  }
  /**
   * Deletes data from the specified position.
   *
   * @param offset - Offset at which to delete
   * @param count  - Number of code units to delete
   */
  deleteData(offset, count) {
    expectArity(arguments, 2);
    replaceData(this, offset, count, "");
  }
  /**
   * Replaces data at the specified position.
   *
   * @param offset - Offset at which to replace
   * @param count  - Number of code units to remove
   * @param data   - Data to insert
   */
  replaceData(offset, count, data) {
    expectArity(arguments, 3);
    replaceData(this, offset, count, data);
  }
};
function replaceData(node, offset, count, data) {
  offset = asUnsignedLong(offset);
  count = asUnsignedLong(count);
  const length = node.length;
  if (offset > length) {
    throwIndexSizeError("can not replace data past the node's length");
  }
  if (offset + count > length) {
    count = length - offset;
  }
  queueMutationRecord("characterData", node, {
    oldValue: node.data
  });
  const nodeData = node.data;
  const newData = nodeData.substring(0, offset) + data + nodeData.substring(offset + count);
  node._data = newData;
  const context = getContext(node);
  context.forEachRange((range2) => {
    if (range2.startContainer === node && range2.startOffset > offset && range2.startOffset <= offset + count) {
      range2.startOffset = offset;
    }
    if (range2.endContainer === node && range2.endOffset > offset && range2.endOffset <= offset + count) {
      range2.endOffset = offset;
    }
    if (range2.startContainer === node && range2.startOffset > offset + count) {
      range2.startOffset = range2.startOffset + data.length - count;
    }
    if (range2.endContainer === node && range2.endOffset > offset + count) {
      range2.endOffset = range2.endOffset + data.length - count;
    }
  });
}
function substringData(node, offset, count) {
  offset = asUnsignedLong(offset);
  count = asUnsignedLong(count);
  const length = node.length;
  if (offset > length) {
    throwIndexSizeError("can not substring data past the node's length");
  }
  if (offset + count > length) {
    return node.data.substring(offset);
  }
  return node.data.substring(offset, offset + count);
}

// slimdom.js/src/Text.ts
var Text = class extends CharacterData {
  // Node
  get nodeType() {
    return 3 /* TEXT_NODE */;
  }
  get nodeName() {
    return "#text";
  }
  // Text
  /**
   * Returns a new Text node whose data is data and node document is current global object’s
   * associated Document.
   *
   * @param data - The data for the new text node
   */
  constructor(data = "") {
    super(data);
    const context = getContext(this);
    this.ownerDocument = context.document;
  }
  /**
   * Splits data at the given offset and returns the remainder as Text node.
   *
   * @param offset - The offset at which to split
   *
   * @returns a text node containing the second half of the split node's data
   */
  splitText(offset) {
    expectArity(arguments, 1);
    offset = asUnsignedLong(offset);
    return splitText(this, offset);
  }
  /**
   * (non-standard) Creates a copy of this, not including its children.
   *
   * @param document - The node document to associate with the copy
   *
   * @returns A shallow copy of this
   */
  _copy(document3) {
    const context = getContext(document3);
    const copy = new context.Text(this.data);
    copy.ownerDocument = document3;
    return copy;
  }
  /**
   * Returns the combined data of all direct Text node siblings.
   *
   * @returns the concatenation of the data of the contiguous Text nodes of this, in
   *          tree order.
   */
  get wholeText() {
    const allData = [this.data];
    let previousSibling = this.previousSibling;
    while (previousSibling !== null && isNodeOfType(previousSibling, 3 /* TEXT_NODE */, 4 /* CDATA_SECTION_NODE */)) {
      const data = previousSibling.data;
      allData.unshift(data);
      previousSibling = previousSibling.previousSibling;
    }
    let nextSibling = this.nextSibling;
    while (nextSibling !== null && isNodeOfType(nextSibling, 3 /* TEXT_NODE */, 4 /* CDATA_SECTION_NODE */)) {
      const data = nextSibling.data;
      allData.push(data);
      nextSibling = nextSibling.nextSibling;
    }
    return allData.join("");
  }
};
function splitText(node, offset) {
  const length = node.length;
  if (offset > length) {
    throwIndexSizeError("can not split past the node's length");
  }
  const count = length - offset;
  const newData = substringData(node, offset, count);
  const context = getContext(node);
  const newNode = new context.Text(newData);
  newNode.ownerDocument = node.ownerDocument;
  const parent = node.parentNode;
  if (parent !== null) {
    insertNode(newNode, parent, node.nextSibling);
    const indexOfNodePlusOne = getNodeIndex(node) + 1;
    const context2 = getContext(node);
    context2.forEachRange((range2) => {
      if (range2.startContainer === node && range2.startOffset > offset) {
        range2.startContainer = newNode;
        range2.startOffset -= offset;
      }
      if (range2.endContainer === node && range2.endOffset > offset) {
        range2.endContainer = newNode;
        range2.endOffset -= offset;
      }
      if (range2.startContainer === parent && range2.startOffset === indexOfNodePlusOne) {
        range2.startOffset += 1;
      }
      if (range2.endContainer === parent && range2.endOffset === indexOfNodePlusOne) {
        range2.endOffset += 1;
      }
    });
  }
  replaceData(node, offset, count, "");
  return newNode;
}

// slimdom.js/src/CDATASection.ts
var CDATASection = class extends Text {
  // Node
  get nodeType() {
    return 4 /* CDATA_SECTION_NODE */;
  }
  get nodeName() {
    return "#cdata-section";
  }
  // CDATASection
  /**
   * (non-standard) use Document#createCDATASection to create a CDATA section.
   *
   * @param data - The data for the node
   */
  constructor(data) {
    super(data);
  }
  /**
   * (non-standard) Creates a copy of this, not including its children.
   *
   * @param document - The node document to associate with the copy
   *
   * @returns A shallow copy of this
   */
  _copy(document3) {
    const context = getContext(document3);
    const copy = new context.CDATASection(this.data);
    copy.ownerDocument = document3;
    return copy;
  }
};

// slimdom.js/src/Comment.ts
var Comment = class extends CharacterData {
  // Node
  get nodeType() {
    return 8 /* COMMENT_NODE */;
  }
  get nodeName() {
    return "#comment";
  }
  // Comment
  /**
   * Returns a new Comment node whose data is data and node document is current global object’s
   * associated Document.
   *
   * @param data - The data for the new comment
   */
  constructor(data = "") {
    super(data);
    const context = getContext(this);
    this.ownerDocument = context.document;
  }
  /**
   * (non-standard) Creates a copy of this, not including its children.
   *
   * @param document - The node document to associate with the copy
   *
   * @returns A shallow copy of this
   */
  _copy(document3) {
    const context = getContext(document3);
    const copy = new context.Comment(this.data);
    copy.ownerDocument = document3;
    return copy;
  }
};

// slimdom.js/src/DocumentType.ts
var DocumentType = class extends Node {
  // Node
  get nodeType() {
    return 10 /* DOCUMENT_TYPE_NODE */;
  }
  get nodeName() {
    return this.name;
  }
  get nodeValue() {
    return null;
  }
  set nodeValue(_newValue) {
  }
  get textContent() {
    return null;
  }
  set textContent(_newValue) {
  }
  lookupPrefix(namespace) {
    expectArity(arguments, 1);
    return null;
  }
  lookupNamespaceURI(prefix) {
    expectArity(arguments, 1);
    return null;
  }
  // ChildNode
  before(...nodes) {
    insertNodesBefore(this, nodes);
  }
  after(...nodes) {
    insertNodesAfter(this, nodes);
  }
  replaceWith(...nodes) {
    replaceWithNodes(this, nodes);
  }
  remove() {
    removeFromParent(this);
  }
  /**
   * (non-standard) Use DOMImplementation#createDocumentType instead.
   *
   * @param name     - The name of the doctype
   * @param publicId - The public ID of the doctype
   * @param systemId - The system ID of the doctype
   */
  constructor(name, publicId = "", systemId = "") {
    super();
    this.name = name;
    this.publicId = publicId;
    this.systemId = systemId;
  }
  /**
   * (non-standard) Creates a copy of this, not including its children.
   *
   * @param document - The node document to associate with the copy
   *
   * @returns A shallow copy of this
   */
  _copy(document3) {
    const context = getContext(document3);
    const copy = new context.DocumentType(this.name, this.publicId, this.systemId);
    copy.ownerDocument = document3;
    return copy;
  }
};

// slimdom.js/src/unsafe.ts
function unsafeCreateAttribute(namespace, prefix, localName, value, ownerElement) {
  return new Attr(namespace, prefix, localName, value, ownerElement);
}
function unsafeCreateElement(document3, localName, namespace, prefix = null) {
  return createElement(document3, localName, namespace, prefix);
}
function unsafeAppendAttribute(attribute, element2) {
  appendAttribute(attribute, element2);
}

// slimdom.js/src/util/namespaceHelpers.ts
var HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
var XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
var XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";
function isValidQName(name) {
  const parts = name.split(":");
  if (parts.length > 2) {
    return false;
  }
  return parts.every((part) => matchesNameProduction(part));
}
function validateQualifiedName(qualifiedName) {
  if (!isValidQName(qualifiedName)) {
    throwInvalidCharacterError("The qualified name is not a valid QName");
  }
}
function validateAndExtract(namespace, qualifiedName) {
  if (namespace === "") {
    namespace = null;
  }
  validateQualifiedName(qualifiedName);
  let prefix = null;
  let localName = qualifiedName;
  const index = qualifiedName.indexOf(":");
  if (index >= 0) {
    prefix = qualifiedName.substring(0, index);
    localName = qualifiedName.substring(index + 1);
  }
  if (prefix !== null && namespace === null) {
    throwNamespaceError("Qualified name with prefix can not have a null namespace");
  }
  if (prefix === "xml" && namespace !== XML_NAMESPACE) {
    throwNamespaceError("xml prefix can only be used for the XML namespace");
  }
  if ((qualifiedName === "xmlns" || prefix === "xmlns") && namespace !== XMLNS_NAMESPACE) {
    throwNamespaceError("xmlns prefix or qualifiedName must use the XMLNS namespace");
  }
  if (namespace === XMLNS_NAMESPACE && qualifiedName !== "xmlns" && prefix !== "xmlns") {
    throwNamespaceError("xmlns prefix or qualifiedName must be used for the XMLNS namespace");
  }
  return { namespace, prefix, localName };
}
function locateNamespacePrefix(element2, namespace) {
  if (element2.namespaceURI === namespace && element2.prefix !== null) {
    return element2.prefix;
  }
  const attr = Array.from(element2.attributes).find(
    (attr2) => attr2.prefix === "xmlns" && attr2.value === namespace
  );
  if (attr) {
    return attr.localName;
  }
  if (element2.parentElement !== null) {
    return locateNamespacePrefix(element2.parentElement, namespace);
  }
  return null;
}

// slimdom.js/src/dom-parsing/EntityExpansionGuard.ts
var EntityExpansionGuard = class {
  constructor(initialInputLength, entityExpansionThreshold, entityExpansionMaxAmplification) {
    this._topLevelEntityRef = null;
    this._depth = 0;
    this._initialInputLength = initialInputLength;
    this._expandedInputLength = initialInputLength;
    this._entityExpansionThreshold = entityExpansionThreshold;
    this._entityExpansionMaxAmplification = entityExpansionMaxAmplification;
  }
  enter(event, replacementTextLength) {
    var _a;
    const topLevelEntityRef = (_a = this._topLevelEntityRef) != null ? _a : event;
    this._expandedInputLength += replacementTextLength;
    if (this._expandedInputLength > this._entityExpansionThreshold) {
      const amplification = this._expandedInputLength / this._initialInputLength;
      if (amplification > this._entityExpansionMaxAmplification) {
        throwErrorWithContext("too much entity expansion", topLevelEntityRef);
      }
    }
    this._topLevelEntityRef = topLevelEntityRef;
    this._depth += 1;
  }
  exit() {
    this._depth -= 1;
    if (this._depth === 0) {
      this._topLevelEntityRef = null;
    }
  }
};

// prsc.js/src/parser-combinators.ts
function okWithValue(offset, value) {
  return { success: true, offset, value };
}
function ok(offset) {
  return okWithValue(offset, void 0);
}
function error(offset, expected, fatal = false) {
  return { success: false, offset, expected, fatal };
}
function token(token2) {
  return (input, offset) => {
    const offsetAfter = offset + token2.length;
    if (input.slice(offset, offsetAfter) === token2) {
      return okWithValue(offsetAfter, token2);
    }
    return error(offset, [token2]);
  };
}
function lengthFromCodePoint(cp2) {
  return cp2 > 65535 ? 2 : 1;
}
function codepoint(isMatch, expected) {
  return (input, offset) => {
    const cp2 = input.codePointAt(offset);
    if (cp2 === void 0 || !isMatch(cp2)) {
      return error(offset, expected);
    }
    return ok(offset + lengthFromCodePoint(cp2));
  };
}
function codepoints(isMatch, expected) {
  return (input, offset) => {
    const startOffset = offset;
    while (true) {
      const cp2 = input.codePointAt(offset);
      if (cp2 === void 0) {
        break;
      }
      if (!isMatch(cp2)) {
        break;
      }
      offset += cp2 > 65535 ? 2 : 1;
    }
    if (expected !== void 0 && offset === startOffset) {
      return error(offset, expected);
    }
    return ok(offset);
  };
}
function range(firstCodePoint, lastCodePoint, expected) {
  return codepoint(
    (cp2) => firstCodePoint <= cp2 && cp2 <= lastCodePoint,
    expected || [
      `${String.fromCodePoint(firstCodePoint)}-${String.fromCodePoint(lastCodePoint)}`
    ]
  );
}
function map(parser, map2) {
  return (input, offset) => {
    const res = parser(input, offset);
    if (!res.success) {
      return res;
    }
    return okWithValue(res.offset, map2(res.value));
  };
}
function consume(parser) {
  return map(parser, () => void 0);
}
function filter(parser, filter2, expected, fatal) {
  return (input, offset) => {
    const res = parser(input, offset);
    if (!res.success) {
      return res;
    }
    if (!filter2(res.value)) {
      return error(offset, expected, fatal);
    }
    return res;
  };
}
function or(parsers, expected) {
  return (input, offset) => {
    let lastError = null;
    for (const parser of parsers) {
      const res = parser(input, offset);
      if (res.success) {
        return res;
      }
      if (lastError === null || res.offset > lastError.offset) {
        lastError = res;
      } else if (res.offset === lastError.offset && expected === void 0) {
        lastError.expected = lastError.expected.concat(res.expected);
      }
      if (res.fatal) {
        return res;
      }
    }
    expected = expected || (lastError == null ? void 0 : lastError.expected) || [];
    if (lastError) {
      lastError.expected = expected;
    }
    return lastError || error(offset, expected);
  };
}
function optional(parser) {
  return (input, offset) => {
    const res = parser(input, offset);
    if (!res.success && !res.fatal) {
      return okWithValue(offset, null);
    }
    return res;
  };
}
function star(parser) {
  return (input, offset) => {
    let ts = [];
    let nextOffset = offset;
    while (true) {
      const res = parser(input, nextOffset);
      if (!res.success) {
        if (res.fatal) {
          return res;
        }
        break;
      }
      ts.push(res.value);
      if (res.offset === nextOffset) {
        break;
      }
      nextOffset = res.offset;
    }
    return okWithValue(nextOffset, ts);
  };
}
function starConsumed(parser) {
  return (input, offset) => {
    let nextOffset = offset;
    while (true) {
      const res = parser(input, nextOffset);
      if (!res.success) {
        if (res.fatal) {
          return res;
        }
        break;
      }
      if (res.offset === nextOffset) {
        break;
      }
      nextOffset = res.offset;
    }
    return ok(nextOffset);
  };
}
function filterUndefined(parser) {
  return map(parser, (vs) => vs.filter((v) => v !== void 0));
}
function then(parser1, parser2, join) {
  return (input, offset) => {
    const r1 = parser1(input, offset);
    if (!r1.success) {
      return r1;
    }
    const r2 = parser2(input, r1.offset);
    if (!r2.success) {
      return r2;
    }
    return okWithValue(r2.offset, join(r1.value, r2.value));
  };
}
function sequence(...parsers) {
  return (input, offset) => {
    const values = [];
    for (const parser of parsers) {
      const res = parser(input, offset);
      if (!res.success) {
        return res;
      }
      offset = res.offset;
      values.push(res.value);
    }
    return okWithValue(offset, values);
  };
}
function sequenceConsumed(...parsers) {
  return (input, offset) => {
    for (const parser of parsers) {
      const res = parser(input, offset);
      if (!res.success) {
        return res;
      }
      offset = res.offset;
    }
    return ok(offset);
  };
}
function first(x, y) {
  return x;
}
function second(x, y) {
  return y;
}
function plusConsumed(parser) {
  return then(parser, starConsumed(parser), second);
}
function preceded(before, parser) {
  return then(before, parser, second);
}
function followed(parser, after) {
  return then(parser, after, first);
}
function delimited(open, inner, close, cutAfterOpen = false) {
  const rest = cutAfterOpen ? cut(followed(inner, close)) : followed(inner, close);
  return preceded(open, rest);
}
function recognize(parser) {
  return (input, offset) => {
    const res = parser(input, offset);
    if (!res.success) {
      return res;
    }
    return okWithValue(res.offset, input.slice(offset, res.offset));
  };
}
function peek(parser) {
  return (input, offset) => {
    const res = parser(input, offset);
    if (!res.success) {
      return res;
    }
    return okWithValue(offset, res.value);
  };
}
function not(parser, expected) {
  return (input, offset) => {
    const res = parser(input, offset);
    if (!res.success) {
      return ok(offset);
    }
    return error(offset, expected);
  };
}
function except(match, except2, expected) {
  return preceded(not(except2, expected), match);
}
function dispatch(mapping, otherwise, extraOffset = 0, expected = []) {
  return (input, offset) => {
    const cp2 = input.codePointAt(offset + extraOffset);
    if (cp2 === void 0) {
      return error(offset, expected);
    }
    const parser = mapping[cp2];
    if (parser === void 0) {
      if (otherwise === void 0) {
        return error(offset, expected);
      }
      return otherwise(input, offset);
    }
    return parser(input, offset);
  };
}
function cut(parser) {
  return (input, offset) => {
    const res = parser(input, offset);
    if (!res.success) {
      return error(res.offset, res.expected, true);
    }
    return res;
  };
}
var end = (input, offset) => input.length === offset ? ok(offset) : error(offset, ["end of input"]);
function complete(parser) {
  return then(parser, end, first);
}

// slimdom.js/src/dom-parsing/ParserStateMachine.ts
var ParserStateMachine = class {
  constructor(input, states) {
    this._state = 0;
    this._offset = 0;
    this._input = input;
    this._states = states;
  }
  next() {
    if (this._state >= this._states.length) {
      return { done: true, value: end(this._input, this._offset) };
    }
    const { parser, type } = this._states[this._state];
    const res = parser(this._input, this._offset);
    if (!res.success) {
      if (type === 0 /* one */ || res.fatal) {
        return { done: true, value: res };
      }
      this._state += 1;
      return this.next();
    }
    this._offset = res.offset;
    if (type !== 1 /* star */) {
      this._state += 1;
    }
    if (res.value === void 0) {
      return this.next();
    }
    return { done: false, value: res.value };
  }
};

// slimdom.js/src/dom-parsing/grammar.ts
function withPosition(parser) {
  return (input, offset) => {
    const start = offset;
    const res = parser(input, offset);
    if (!res.success) {
      return res;
    }
    return okWithValue(res.offset, { input, start, end: res.offset, ...res.value });
  };
}
var UNDERSCORE = token("_");
var DASH = token("-");
var PERIOD = token(".");
var DOUBLE_QUOTE = token('"');
var SINGLE_QUOTE = token("'");
var ANGLE_BRACKET_OPEN = token("<");
var ANGLE_BRACKET_CLOSE = token(">");
var AMPERSAND = token("&");
var EQUALS = token("=");
var SQUARE_BRACKET_OPEN = token("[");
var SQUARE_BRACKET_CLOSE = token("]");
var SEMICOLON = token(";");
var PERCENT = token("%");
var PARENTHESIS_OPEN = token("(");
var PARENTHESIS_CLOSE = token(")");
var PLUS = token("+");
var COMMA = token(",");
var QUESTION_MARK = token("?");
var ASTERISK = token("*");
var VERTICAL_BAR = token("|");
var SECT_END = token("]]>");
var COMMENT_START = token("<!--");
var COMMENT_END = token("-->");
var PI_START = token("<?");
var PI_END = token("?>");
var ONE_POINT = token("1.");
var VERSION = token("version");
var ENCODING = token("encoding");
var STANDALONE = token("standalone");
var YES = token("yes");
var NO = token("no");
var XML_DECL_START = token("<?xml");
var DOCTYPE_START = token("<!DOCTYPE");
var SYSTEM = token("SYSTEM");
var PUBLIC = token("PUBLIC");
var ETAG_START = token("</");
var EMPTY_ELEMENT_END = token("/>");
var CHARREF_START = token("&#");
var CHARREF_HEX_START = token("&#x");
var ELEMENT_DECL_START = token("<!ELEMENT");
var EMPTY = token("EMPTY");
var ANY = token("ANY");
var PCDATA = token("#PCDATA");
var ATTLIST_DECL_START = token("<!ATTLIST");
var NOTATION = token("NOTATION");
var REQUIRED = token("#REQUIRED");
var IMPLIED = token("#IMPLIED");
var FIXED = token("#FIXED");
var ENTITY_DECL_START = token("<!ENTITY");
var NDATA = token("NDATA");
var NOTATION_DECL_START = token("<!NOTATION");
var UPPER_A_CP = 65;
var UPPER_Z_CP = 90;
var UPPER_ALPHA = range(UPPER_A_CP, UPPER_Z_CP);
var LOWER_A_CP = 97;
var LOWER_Z_CP = 122;
var LOWER_ALPHA = range(LOWER_A_CP, LOWER_Z_CP);
var ZERO_CP = 48;
var NINE_CP = 57;
var DIGIT = range(ZERO_CP, NINE_CP);
var HEX_DIGIT = or([DIGIT, range(65, 70), range(97, 102)], ["hexadecimal digit"]);
function isValidChar(cp2) {
  return cp2 === 9 || cp2 === 10 || cp2 === 13 || 32 <= cp2 && cp2 <= 55295 || 57344 <= cp2 && cp2 <= 65533 || 65536 <= cp2 && cp2 <= 1114111;
}
var CompleteChars = complete(codepoints(isValidChar));
function isValidWhitespace(cp2) {
  return cp2 === 32 || cp2 === 9 || cp2 === 13 || cp2 === 10;
}
var S = codepoints(isValidWhitespace, ["whitespace"]);
var CompleteWhitespace = complete(codepoints(isValidWhitespace));
var COLON_CP = 58;
var UNDERSCORE_CP = 95;
function isValidNameStartChar(cp2) {
  return cp2 === COLON_CP || UPPER_A_CP <= cp2 && cp2 <= UPPER_Z_CP || cp2 === UNDERSCORE_CP || LOWER_A_CP <= cp2 && cp2 <= LOWER_Z_CP || 192 <= cp2 && cp2 <= 214 || 216 <= cp2 && cp2 <= 246 || 248 <= cp2 && cp2 <= 767 || 880 <= cp2 && cp2 <= 893 || 895 <= cp2 && cp2 <= 8191 || 8204 <= cp2 && cp2 <= 8205 || 8304 <= cp2 && cp2 <= 8591 || 11264 <= cp2 && cp2 <= 12271 || 12289 <= cp2 && cp2 <= 55295 || 63744 <= cp2 && cp2 <= 64975 || 65008 <= cp2 && cp2 <= 65533 || 65536 <= cp2 && cp2 <= 983039;
}
var NameStartChar = codepoint(isValidNameStartChar, ["valid name start character"]);
var DASH_CP = 45;
var PERIOD_CP = 46;
function isValidNameChar(cp2) {
  return isValidNameStartChar(cp2) || cp2 === DASH_CP || cp2 === PERIOD_CP || ZERO_CP <= cp2 && cp2 <= NINE_CP || cp2 === 183 || 768 <= cp2 && cp2 <= 879 || 8255 <= cp2 && cp2 <= 8256;
}
var Name = recognize(preceded(NameStartChar, codepoints(isValidNameChar)));
var CompleteName = complete(Name);
var NCName = filter(Name, (name) => !name.includes(":"), ["name must not contain colon"], true);
var Nmtoken = recognize(codepoints(isValidNameChar, ["valid name character"]));
var CharRef = withPosition(
  map(
    filter(
      or([
        map(
          delimited(
            CHARREF_HEX_START,
            recognize(plusConsumed(HEX_DIGIT)),
            SEMICOLON,
            true
          ),
          (n) => parseInt(n, 16)
        ),
        map(
          delimited(CHARREF_START, recognize(plusConsumed(DIGIT)), SEMICOLON, true),
          (n) => parseInt(n, 10)
        )
      ]),
      (cp2) => isValidChar(cp2),
      ["character reference must reference a valid character"],
      true
    ),
    (cp2) => ({ type: 0 /* CharRef */, cp: cp2 })
  )
);
var EntityRef = withPosition(
  map(delimited(AMPERSAND, NCName, cut(SEMICOLON)), (name) => ({
    type: 1 /* EntityRef */,
    name
  }))
);
var Reference = or([EntityRef, CharRef]);
var PEReference = withPosition(
  map(delimited(PERCENT, NCName, SEMICOLON), (name) => ({
    type: 2 /* PEReference */,
    name
  }))
);
var PERCENT_CP = 37;
var AMPERSAND_CP = 38;
var EntityValue = or([
  delimited(
    DOUBLE_QUOTE,
    star(
      or([
        recognize(
          codepoints(
            (cp2) => cp2 !== PERCENT_CP && cp2 !== AMPERSAND_CP && cp2 !== DOUBLE_QUOTE_CP && isValidChar(cp2),
            []
          )
        ),
        PEReference,
        Reference
      ])
    ),
    DOUBLE_QUOTE,
    true
  ),
  delimited(
    SINGLE_QUOTE,
    star(
      or([
        recognize(
          codepoints(
            (cp2) => cp2 !== PERCENT_CP && cp2 !== AMPERSAND_CP && cp2 !== SINGLE_QUOTE_CP && isValidChar(cp2),
            []
          )
        ),
        PEReference,
        Reference
      ])
    ),
    SINGLE_QUOTE,
    true
  )
]);
var DOUBLE_QUOTE_CP = 34;
var SINGLE_QUOTE_CP = 39;
var AttValue = dispatch(
  {
    [DOUBLE_QUOTE_CP]: delimited(
      DOUBLE_QUOTE,
      star(
        dispatch(
          {
            [AMPERSAND_CP]: Reference
          },
          recognize(
            codepoints(
              (cp2) => cp2 !== ANGLE_BRACKET_OPEN_CP && cp2 !== AMPERSAND_CP && cp2 !== DOUBLE_QUOTE_CP && isValidChar(cp2),
              []
            )
          )
        )
      ),
      DOUBLE_QUOTE,
      true
    ),
    [SINGLE_QUOTE_CP]: delimited(
      SINGLE_QUOTE,
      star(
        dispatch(
          {
            [AMPERSAND_CP]: Reference
          },
          recognize(
            codepoints(
              (cp2) => cp2 !== ANGLE_BRACKET_OPEN_CP && cp2 !== AMPERSAND_CP && cp2 !== SINGLE_QUOTE_CP && isValidChar(cp2),
              []
            )
          )
        )
      ),
      SINGLE_QUOTE,
      true
    )
  },
  void 0,
  0,
  ["quoted attribute value"]
);
var EntityReplacementTextInLiteral = complete(
  star(
    or([
      recognize(
        codepoints(
          (cp2) => cp2 !== ANGLE_BRACKET_OPEN_CP && cp2 !== AMPERSAND_CP && isValidChar(cp2),
          []
        )
      ),
      Reference
    ])
  )
);
var SystemLiteral = filter(
  or([
    delimited(
      DOUBLE_QUOTE,
      recognize(codepoints((cp2) => cp2 !== DOUBLE_QUOTE_CP && isValidChar(cp2))),
      DOUBLE_QUOTE
    ),
    delimited(
      SINGLE_QUOTE,
      recognize(codepoints((cp2) => cp2 !== SINGLE_QUOTE_CP && isValidChar(cp2))),
      SINGLE_QUOTE
    )
  ]),
  (systemId) => !systemId.includes("#"),
  ["system identifier must not contain a fragment identifier"],
  true
);
function isValidPubidChar(cp2) {
  return cp2 === 32 || cp2 === 13 || cp2 === 10 || LOWER_A_CP <= cp2 && cp2 <= LOWER_Z_CP || UPPER_A_CP <= cp2 && cp2 <= UPPER_Z_CP || ZERO_CP <= cp2 && cp2 <= NINE_CP || 33 <= cp2 && cp2 <= 47 && cp2 !== 34 && cp2 !== 38 || 58 <= cp2 && cp2 <= 64 && cp2 !== 60 && cp2 !== 62 || cp2 === 95;
}
var CompletePubidChars = complete(codepoints(isValidPubidChar));
var PubidLiteral = or([
  delimited(
    DOUBLE_QUOTE,
    recognize(codepoints((cp2) => cp2 !== DOUBLE_QUOTE_CP && isValidPubidChar(cp2))),
    DOUBLE_QUOTE,
    true
  ),
  delimited(
    SINGLE_QUOTE,
    recognize(codepoints((cp2) => cp2 !== SINGLE_QUOTE_CP && isValidPubidChar(cp2))),
    SINGLE_QUOTE,
    true
  )
]);
var ANGLE_BRACKET_OPEN_CP = 60;
var SQUARE_BRACKET_CLOSE_CP = 93;
var CharData = recognize(
  plusConsumed(
    or(
      [
        // Fast path: filtered codepoints
        codepoints(
          (cp2) => cp2 !== ANGLE_BRACKET_OPEN_CP && cp2 !== AMPERSAND_CP && cp2 !== SQUARE_BRACKET_CLOSE_CP && isValidChar(cp2),
          []
        ),
        // Square bracket is allowed if it's not a SECT_END
        except(consume(SQUARE_BRACKET_CLOSE), SECT_END, [])
      ],
      ["character data"]
    )
  )
);
var Comment2 = map(
  delimited(
    COMMENT_START,
    recognize(
      starConsumed(
        or([
          // Fast path - any Char except "-"
          codepoints((cp2) => cp2 !== DASH_CP && isValidChar(cp2), []),
          // Dash may not be followed by another dash
          followed(consume(DASH), not(DASH, ["comment content may not contain --"]))
        ])
      )
    ),
    COMMENT_END,
    true
  ),
  (data) => ({ type: 3 /* Comment */, data })
);
var PITarget = filter(
  NCName,
  (target) => target.toLowerCase() !== "xml",
  ['processing instruction target must not be "xml"'],
  true
);
var QUESTION_MARK_CP = 63;
var PI = delimited(
  PI_START,
  then(
    PITarget,
    optional(
      preceded(
        S,
        recognize(
          starConsumed(
            or([
              // Fast path - any Char except "?"
              codepoints((cp2) => cp2 !== QUESTION_MARK_CP && isValidChar(cp2), []),
              // Question mark must not be part of "?>"
              followed(consume(QUESTION_MARK), not(ANGLE_BRACKET_CLOSE, ["PI data"]))
            ])
          )
        )
      )
    ),
    (target, data) => ({ type: 4 /* PI */, target, data })
  ),
  PI_END,
  true
);
var CDStart = token("<![CDATA[");
var CData = recognize(
  starConsumed(
    or([
      // Fast path - any Char except ]
      codepoints((cp2) => cp2 !== SQUARE_BRACKET_CLOSE_CP && isValidChar(cp2), []),
      except(consume(SQUARE_BRACKET_CLOSE), SECT_END, ["CData"])
    ])
  )
);
var CDEnd = SECT_END;
var CDSect = withPosition(
  map(delimited(CDStart, CData, CDEnd, true), (data) => ({
    type: 5 /* CDSect */,
    data
  }))
);
var Eq = delimited(optional(S), EQUALS, optional(S));
var VersionNum = recognize(preceded(ONE_POINT, plusConsumed(DIGIT)));
var VersionInfo = preceded(
  S,
  preceded(
    VERSION,
    preceded(
      Eq,
      or([
        delimited(DOUBLE_QUOTE, VersionNum, DOUBLE_QUOTE, true),
        delimited(SINGLE_QUOTE, VersionNum, SINGLE_QUOTE, true)
      ])
    )
  )
);
var EncName = recognize(
  preceded(
    or([UPPER_ALPHA, LOWER_ALPHA]),
    starConsumed(
      or([
        UPPER_ALPHA,
        LOWER_ALPHA,
        DIGIT,
        consume(PERIOD),
        consume(UNDERSCORE),
        consume(DASH)
      ])
    )
  )
);
var EncodingDecl = preceded(
  S,
  preceded(
    ENCODING,
    preceded(
      Eq,
      or([
        delimited(DOUBLE_QUOTE, EncName, DOUBLE_QUOTE, true),
        delimited(SINGLE_QUOTE, EncName, SINGLE_QUOTE, true)
      ])
    )
  )
);
var YesOrNo = or([map(YES, () => true), map(NO, () => false)]);
var SDDecl = preceded(
  S,
  preceded(
    STANDALONE,
    cut(
      preceded(
        Eq,
        or([
          delimited(DOUBLE_QUOTE, YesOrNo, DOUBLE_QUOTE, true),
          delimited(SINGLE_QUOTE, YesOrNo, SINGLE_QUOTE, true)
        ])
      )
    )
  )
);
var XMLDecl = delimited(
  // PIs may also start with <?xml, but may never have their target be just 'xml'
  // We can therefore consider it a fatal error if parsing fails after the space
  followed(XML_DECL_START, peek(S)),
  followed(
    then(
      VersionInfo,
      then(optional(EncodingDecl), optional(SDDecl), (e, s) => [e, s]),
      (version, [encoding, standalone]) => ({
        type: 6 /* XMLDecl */,
        version,
        encoding,
        standalone
      })
    ),
    optional(S)
  ),
  PI_END,
  true
);
var NameWithPosition = withPosition(map(Name, (name) => ({ name })));
var Attribute = then(
  NameWithPosition,
  preceded(cut(Eq), cut(AttValue)),
  (name, value) => ({
    name,
    value
  })
);
var Attributes = followed(star(preceded(S, Attribute)), optional(S));
var SOLIDUS_CP = 47;
var STagOrEmptyElemTag = map(
  sequence(
    ANGLE_BRACKET_OPEN,
    NameWithPosition,
    cut(Attributes),
    cut(
      dispatch(
        { [SOLIDUS_CP]: map(EMPTY_ELEMENT_END, () => true) },
        map(ANGLE_BRACKET_CLOSE, () => false),
        0,
        [">", "/>"]
      )
    )
  ),
  ([_, name, attributes, isEmpty]) => ({
    type: isEmpty ? 9 /* EmptyElemTag */ : 7 /* STag */,
    name,
    attributes
  })
);
var ETag = withPosition(
  map(delimited(ETAG_START, followed(Name, optional(S)), ANGLE_BRACKET_CLOSE, true), (name) => ({
    type: 8 /* ETag */,
    name
  }))
);
var Multiplicity = or([QUESTION_MARK, ASTERISK, PLUS]);
var cp = followed(
  or([consume(Name), choiceIndirect, seqIndirect]),
  consume(optional(Multiplicity))
);
var choice = sequenceConsumed(
  PARENTHESIS_OPEN,
  optional(S),
  cp,
  plusConsumed(sequence(optional(S), VERTICAL_BAR, optional(S), cut(cp))),
  optional(S),
  PARENTHESIS_CLOSE
);
function choiceIndirect(input, offset) {
  return choice(input, offset);
}
var seq = sequenceConsumed(
  PARENTHESIS_OPEN,
  optional(S),
  cp,
  starConsumed(sequence(optional(S), COMMA, optional(S), cut(cp))),
  optional(S),
  PARENTHESIS_CLOSE
);
function seqIndirect(input, offset) {
  return seq(input, offset);
}
var children = followed(or([choice, seq]), optional(Multiplicity));
var Mixed = sequenceConsumed(
  PARENTHESIS_OPEN,
  optional(S),
  PCDATA,
  or([
    sequenceConsumed(
      starConsumed(sequenceConsumed(optional(S), VERTICAL_BAR, optional(S), Name)),
      optional(S),
      PARENTHESIS_CLOSE,
      ASTERISK
    ),
    consume(followed(optional(S), PARENTHESIS_CLOSE))
  ])
);
var contentspec = or([consume(EMPTY), consume(ANY), consume(Mixed), consume(children)]);
var elementdecl = followed(
  ELEMENT_DECL_START,
  cut(sequenceConsumed(S, Name, S, contentspec, optional(S), ANGLE_BRACKET_CLOSE))
);
var StringType = token("CDATA");
var TokenizedType = or([
  token("IDREFS"),
  token("IDREF"),
  token("ID"),
  token("ENTITY"),
  token("ENTITIES"),
  token("NMTOKENS"),
  token("NMTOKEN")
]);
var NotationType = followed(
  NOTATION,
  cut(
    sequenceConsumed(
      S,
      PARENTHESIS_OPEN,
      optional(S),
      NCName,
      starConsumed(sequenceConsumed(optional(S), VERTICAL_BAR, optional(S), NCName)),
      optional(S),
      PARENTHESIS_CLOSE
    )
  )
);
var Enumeration = followed(
  PARENTHESIS_OPEN,
  cut(
    sequenceConsumed(
      optional(S),
      Nmtoken,
      starConsumed(sequenceConsumed(optional(S), VERTICAL_BAR, optional(S), Nmtoken)),
      optional(S),
      PARENTHESIS_CLOSE
    )
  )
);
var EnumeratedType = or([NotationType, Enumeration]);
var AttType = or([
  map(StringType, () => true),
  map(TokenizedType, () => false),
  map(EnumeratedType, () => false)
]);
var DefaultDecl = or([
  map(REQUIRED, () => ({ type: 0 /* REQUIRED */ })),
  map(IMPLIED, () => ({ type: 1 /* IMPLIED */ })),
  then(
    map(optional(followed(FIXED, S)), (v) => v !== null),
    AttValue,
    (fixed, value) => ({ type: 2 /* VALUE */, fixed, value })
  )
]);
var AttDef = then(
  preceded(S, NameWithPosition),
  cut(then(preceded(S, AttType), preceded(S, DefaultDecl), (isCData, def) => ({ isCData, def }))),
  (name, { isCData, def }) => ({ name, isCData, def })
);
var AttlistDecl = delimited(
  followed(ATTLIST_DECL_START, S),
  then(Name, cut(star(AttDef)), (name, attdefs) => ({
    type: 0 /* AttlistDecl */,
    name,
    attdefs
  })),
  preceded(optional(S), ANGLE_BRACKET_CLOSE),
  true
);
var ExternalID = or([
  map(preceded(SYSTEM, cut(preceded(S, SystemLiteral))), (systemId) => ({
    publicId: null,
    systemId
  })),
  preceded(
    PUBLIC,
    then(cut(preceded(S, PubidLiteral)), preceded(S, SystemLiteral), (publicId, systemId) => ({
      publicId,
      systemId
    }))
  )
]);
var NDataDecl = preceded(delimited(S, NDATA, S), NCName);
var EntityDef = or([
  EntityValue,
  then(ExternalID, optional(NDataDecl), (ids, ndata) => ({
    ids,
    ndata
  }))
]);
var GEDecl = delimited(
  ENTITY_DECL_START,
  then(preceded(S, NCName), cut(preceded(S, EntityDef)), (name, value) => ({
    type: 1 /* GEDecl */,
    name,
    value
  })),
  preceded(optional(S), ANGLE_BRACKET_CLOSE)
);
var PEDef = or([EntityValue, consume(ExternalID)]);
var PEDecl = delimited(
  followed(ENTITY_DECL_START, preceded(S, PERCENT)),
  then(
    preceded(S, NCName),
    cut(preceded(S, PEDef)),
    (name, value) => value ? {
      type: 2 /* PEDecl */,
      name,
      value
    } : void 0
  ),
  preceded(optional(S), ANGLE_BRACKET_CLOSE),
  true
);
var EntityDecl = preceded(peek(ENTITY_DECL_START), cut(or([GEDecl, PEDecl])));
var TextDecl = delimited(
  // PIs may also start with <?xml, but may never have their target be just 'xml'
  // We can therefore consider it a fatal error if parsing fails after the space
  followed(XML_DECL_START, peek(S)),
  followed(
    then(optional(VersionInfo), EncodingDecl, (version, encoding) => ({
      type: 6 /* XMLDecl */,
      version,
      encoding,
      standalone: null
    })),
    optional(S)
  ),
  PI_END,
  true
);
var PublicID = map(
  followed(followed(PUBLIC, S), cut(PubidLiteral)),
  (publicId) => ({ publicId, systemId: null })
);
var NotationDecl = delimited(
  NOTATION_DECL_START,
  then(delimited(S, NCName, S), or([consume(ExternalID), consume(PublicID)]), () => void 0),
  preceded(optional(S), ANGLE_BRACKET_CLOSE),
  true
);
var markupdecl = or([
  consume(elementdecl),
  AttlistDecl,
  EntityDecl,
  consume(NotationDecl),
  consume(PI),
  consume(Comment2)
]);
var DeclSep = or([consume(PEReference), consume(S)]);
var intSubset = filterUndefined(
  star(or([markupdecl, DeclSep]))
);
var doctypedecl = preceded(
  DOCTYPE_START,
  cut(
    map(
      sequence(
        S,
        Name,
        optional(preceded(S, ExternalID)),
        optional(S),
        optional(
          followed(
            delimited(SQUARE_BRACKET_OPEN, intSubset, SQUARE_BRACKET_CLOSE, true),
            optional(S)
          )
        ),
        ANGLE_BRACKET_CLOSE
      ),
      ([_1, name, ids, _2, intSubset2, _3]) => ({
        type: 10 /* Doctypedecl */,
        name,
        ids,
        intSubset: intSubset2
      })
    )
  )
);
var EXCLAMATION_MARK_CP = 33;
var contentEvent = dispatch(
  {
    [ANGLE_BRACKET_OPEN_CP]: dispatch(
      {
        [SOLIDUS_CP]: ETag,
        [EXCLAMATION_MARK_CP]: or([Comment2, CDSect]),
        [QUESTION_MARK_CP]: PI
      },
      STagOrEmptyElemTag,
      1
    ),
    [AMPERSAND_CP]: Reference
  },
  CharData
);
var content = {
  parser: contentEvent,
  type: 1 /* star */
};
function parseContent(input) {
  return new ParserStateMachine(input, [content]);
}
var Misc = or([Comment2, PI, S]);
var prolog = [
  { parser: XMLDecl, type: 2 /* optional */ },
  { parser: Misc, type: 1 /* star */ },
  { parser: doctypedecl, type: 2 /* optional */ },
  { parser: Misc, type: 1 /* star */ }
];
var element = [
  { parser: STagOrEmptyElemTag, type: 0 /* one */ },
  content
];
var document = [...prolog, ...element];
function parseDocument(input) {
  return new ParserStateMachine(input, document);
}
var extParsedEnt = [
  { parser: TextDecl, type: 2 /* optional */ },
  content
];
function parseFragment(input) {
  return new ParserStateMachine(input, extParsedEnt);
}

// slimdom.js/src/dom-parsing/parsingAlgorithms.ts
function offsetToCoords(input, offset) {
  let line = 1;
  let char = 1;
  let i = 0;
  while (i < offset) {
    const cp2 = input.codePointAt(i);
    const l = cp2 > 65535 ? 2 : 1;
    char++;
    i += l;
    if (cp2 === 10) {
      line++;
      char = 1;
    }
  }
  return { line, char };
}
function replaceInvalidCharacters(input) {
  return Array.from(
    input,
    (char) => matchesCharProduction(char) ? char : "[invalid character]"
  ).join("");
}
function truncate(input, side, max) {
  const ELLIPSIS = "\u2026";
  const chars = Array.from(input);
  if (chars.length < max) {
    return input;
  }
  switch (side) {
    case 0 /* Start */:
      return ELLIPSIS + chars.slice(-max).join("");
    case 1 /* End */:
      return chars.slice(0, max).join("") + ELLIPSIS;
  }
  const halfLength = Math.min(chars.length / 2, max / 2) | 0;
  return chars.slice(0, halfLength).join("") + ELLIPSIS + chars.slice(-halfLength).join("");
}
function highlightError(input, start, end2) {
  const inside = truncate(
    replaceInvalidCharacters(input.substring(start, end2)),
    2 /* Inside */,
    30
  );
  const newlineIndexBefore = input.lastIndexOf("\n", start);
  const lineBefore = truncate(
    replaceInvalidCharacters(input.substring(newlineIndexBefore + 1, start)),
    0 /* Start */,
    55 - inside.length
  );
  const newlineIndexAfter = input.indexOf("\n", end2);
  const lineAfter = truncate(
    replaceInvalidCharacters(
      newlineIndexAfter > 0 ? input.substring(end2, newlineIndexAfter) : input.substring(end2)
    ),
    1 /* End */,
    80 - inside.length - lineBefore.length
  );
  const indent = Array.from(lineBefore, (c) => isWhitespace(c) ? c : " ").join("");
  const squiggle = "^".repeat(Math.max(Array.from(inside).length, 1));
  return `${lineBefore}${inside}${lineAfter}
${indent}${squiggle}`;
}
function throwErrorWithContext(message, event) {
  const { line, char } = offsetToCoords(event.input, event.start);
  const location = `At line ${line}, character ${char}:`;
  throw new Error(
    `${message}
${location}

${highlightError(event.input, event.start, event.end)}`
  );
}
function throwParseError(what, input, expected, offset) {
  const quoted = Array.from(
    new Set(expected),
    (str) => str.includes('"') ? `'${str}'` : `"${str}"`
  );
  const cp2 = input.codePointAt(offset);
  const actual = cp2 ? String.fromCodePoint(cp2) : "";
  throwErrorWithContext(
    `Parsing ${what} failed, expected ${quoted.length > 1 ? "one of " + quoted.join(", ") : quoted[0]}`,
    { input, start: offset, end: offset + Math.max(actual.length, 1) }
  );
}
function matchesCharProduction(value) {
  return CompleteChars(value, 0).success;
}
function matchesNameProduction(name) {
  return CompleteName(name, 0).success;
}
function matchesPubidCharProduction(value) {
  return CompletePubidChars(value, 0).success;
}
function isWhitespace(value) {
  return CompleteWhitespace(value, 0).success;
}
function constructReplacementText(value) {
  const replacementText = [];
  for (const event of value) {
    if (typeof event === "string") {
      replacementText.push(event);
      continue;
    }
    switch (event.type) {
      case 0 /* CharRef */:
        replacementText.push(String.fromCodePoint(event.cp));
        break;
      case 1 /* EntityRef */:
        replacementText.push(`&${event.name};`);
        break;
      case 2 /* PEReference */:
        throwErrorWithContext(
          `reference to parameter entity "${event.name}" must not occur in an entity declaration in the internal subset`,
          event
        );
    }
  }
  return replacementText.join("");
}
var Dtd = class {
  constructor(dtd) {
    this._attlistByName = /* @__PURE__ */ new Map();
    this._entityReplacementTextByName = /* @__PURE__ */ new Map();
    this._externalEntityNames = /* @__PURE__ */ new Set();
    this._unparsedEntityNames = /* @__PURE__ */ new Set();
    if (!dtd.intSubset) {
      return;
    }
    for (const decl of dtd.intSubset) {
      switch (decl.type) {
        case 0 /* AttlistDecl */: {
          for (const attr of decl.attdefs) {
            if (attr.def.type === 2 /* VALUE */) {
              for (const event of attr.def.value) {
                if (typeof event === "string") {
                  continue;
                }
                if (event.type === 1 /* EntityRef */) {
                  if (!this._entityReplacementTextByName.has(event.name) && !this._externalEntityNames.has(event.name) && !this._unparsedEntityNames.has(event.name)) {
                    throwErrorWithContext(
                      `default value of attribute "${attr.name.name}" contains reference to undefined entity "${event.name}"`,
                      event
                    );
                  }
                  if (this._externalEntityNames.has(event.name)) {
                    throwErrorWithContext(
                      `default value of attribute "${attr.name.name}" must not contain reference to external entity "${event.name}"`,
                      event
                    );
                  }
                }
              }
            }
          }
          let defByName = this._attlistByName.get(decl.name);
          if (defByName === void 0) {
            defByName = /* @__PURE__ */ new Map();
            this._attlistByName.set(decl.name, defByName);
          }
          for (const attr of decl.attdefs) {
            if (defByName.has(attr.name.name)) {
              continue;
            }
            defByName.set(attr.name.name, attr);
          }
          break;
        }
        case 2 /* PEDecl */: {
          if (Array.isArray(decl.value)) {
            for (const event of decl.value) {
              if (typeof event !== "string" && event.type === 2 /* PEReference */) {
                throwErrorWithContext(
                  `reference to parameter entity "${event.name}" must not occur in an entity declaration in the internal subset`,
                  event
                );
              }
            }
          }
          break;
        }
        case 1 /* GEDecl */: {
          if (this._entityReplacementTextByName.has(decl.name) || this._externalEntityNames.has(decl.name)) {
            continue;
          }
          if (Array.isArray(decl.value)) {
            this._entityReplacementTextByName.set(
              decl.name,
              constructReplacementText(decl.value)
            );
          } else if (decl.value.ndata === null) {
            this._externalEntityNames.add(decl.name);
          } else {
            this._unparsedEntityNames.add(decl.name);
          }
        }
      }
    }
  }
  getAttlist(nameEvent) {
    return this._attlistByName.get(nameEvent.name);
  }
  getEntityReplacementText(event, allowExternal) {
    const value = this._entityReplacementTextByName.get(event.name);
    if (value === void 0) {
      if (this._unparsedEntityNames.has(event.name)) {
        throwErrorWithContext(
          `reference to binary entity "${event.name}" is not allowed`,
          event
        );
      }
      if (this._externalEntityNames.has(event.name)) {
        if (allowExternal) {
          return "";
        }
        throwErrorWithContext(
          `reference to external entity "${event.name}" is not allowed in attribute value`,
          event
        );
      }
    }
    return value;
  }
};
var predefinedEntitiesReplacementText = /* @__PURE__ */ new Map([
  ["lt", "&#60;"],
  ["gt", ">"],
  ["amp", "&#38;"],
  ["apos", "'"],
  ["quot", '"']
]);
function normalizeAndIncludeEntities(normalized, value, dtd, ancestorEntities, expansionGuard) {
  for (const event of value) {
    if (typeof event === "string") {
      normalized.push(event.replace(/[\r\n\t]/g, " "));
      continue;
    }
    if (event.type === 0 /* CharRef */) {
      normalized.push(String.fromCodePoint(event.cp));
      continue;
    }
    if (ancestorEntities !== null && ancestorEntities.includes(event.name)) {
      throwErrorWithContext(
        `reference to entity "${event.name}" must not be recursive`,
        event
      );
    }
    let replacementText = predefinedEntitiesReplacementText.get(event.name);
    if (replacementText === void 0 && dtd !== null) {
      replacementText = dtd.getEntityReplacementText(event, false);
    }
    if (replacementText === void 0) {
      throwErrorWithContext(
        `reference to unknown entity "${event.name}" in attribute value`,
        event
      );
    }
    expansionGuard.enter(event, replacementText.length);
    const result = EntityReplacementTextInLiteral(replacementText, 0);
    if (!result.success) {
      throwParseError(
        `replacement text for entity "${event.name}"`,
        replacementText,
        result.expected,
        result.offset
      );
    }
    normalizeAndIncludeEntities(
      normalized,
      result.value,
      dtd,
      ancestorEntities ? [event.name, ...ancestorEntities] : [event.name],
      expansionGuard
    );
    expansionGuard.exit();
  }
}
function normalizeAttributeValue(value, attDef, dtd, expansionGuard) {
  const normalized = [];
  normalizeAndIncludeEntities(normalized, value, dtd, null, expansionGuard);
  if (attDef && !attDef.isCData) {
    return normalized.join("").replace(/[ ]+/g, " ").replace(/^[ ]+|[ ]+$/g, "");
  }
  return normalized.join("");
}
function splitQualifiedName(event, cache) {
  const qualifiedName = event.name;
  const fromCache = cache.get(qualifiedName);
  if (fromCache !== void 0) {
    return fromCache;
  }
  let prefix = null;
  let localName = qualifiedName;
  const index = qualifiedName.indexOf(":");
  if (index >= 0) {
    prefix = qualifiedName.substring(0, index);
    localName = qualifiedName.substring(index + 1);
  }
  if (prefix === "" || localName === "" || localName.includes(":")) {
    throwErrorWithContext(`the name "${qualifiedName}" is not a valid qualified name`, event);
  }
  const parts = { prefix, localName };
  cache.set(qualifiedName, parts);
  return parts;
}
var Namespaces = class _Namespaces {
  constructor(parent, resolve = null) {
    this._byPrefix = /* @__PURE__ */ new Map();
    this._resolve = null;
    var _a;
    this._parent = parent;
    this._resolve = (_a = resolve != null ? resolve : parent == null ? void 0 : parent._resolve) != null ? _a : null;
  }
  getForElement(prefix, event) {
    if (prefix === "xmlns") {
      throwErrorWithContext('element names must not have the prefix "xmlns"', event);
    }
    for (let ns = this; ns !== null; ns = ns._parent) {
      const namespace = ns._byPrefix.get(prefix);
      if (namespace !== void 0) {
        return namespace;
      }
    }
    if (prefix !== null && this._resolve) {
      const namespace = this._resolve(prefix);
      if (namespace !== void 0) {
        return namespace;
      }
    }
    throwErrorWithContext(`use of undeclared element prefix "${prefix}"`, event);
  }
  getForAttribute(prefix, localName, event) {
    if (prefix === null) {
      return localName === "xmlns" ? XMLNS_NAMESPACE : null;
    }
    for (let ns = this; ns !== null; ns = ns._parent) {
      const namespace = ns._byPrefix.get(prefix);
      if (namespace !== void 0) {
        return namespace;
      }
    }
    if (this._resolve) {
      const namespace = this._resolve(prefix);
      if (namespace !== void 0) {
        return namespace;
      }
    }
    throwErrorWithContext(`use of undeclared attribute prefix ${prefix}`, event);
  }
  static fromAttrs(parent, event, attlist, dtd, qualifiedNameCache, expansionGuard) {
    let ns = parent;
    let hasDeclarations = false;
    const add = (prefix, namespace, event2) => {
      if (prefix === null && (namespace === XML_NAMESPACE || namespace === XMLNS_NAMESPACE)) {
        throwErrorWithContext(
          `the namespace "${namespace}" must not be used as the default namespace`,
          event2
        );
      }
      if (namespace === XMLNS_NAMESPACE) {
        throwErrorWithContext(
          `the namespace "${XMLNS_NAMESPACE}" must not be bound to a prefix`,
          event2
        );
      }
      if (namespace === XML_NAMESPACE && prefix !== "xml") {
        throwErrorWithContext(
          `the namespace "${XML_NAMESPACE}" must be bound only to the prefix "xml"`,
          event2
        );
      }
      if (namespace !== XML_NAMESPACE && prefix === "xml") {
        throwErrorWithContext(
          `the xml namespace prefix must not be bound to any namespace other than "${XML_NAMESPACE}"`,
          event2
        );
      }
      if (prefix !== null && namespace === null) {
        throwErrorWithContext(`the prefix "${prefix}" must not be undeclared`, event2);
      }
      if (!hasDeclarations) {
        ns = new _Namespaces(parent);
        hasDeclarations = true;
      }
      ns._byPrefix.set(prefix, namespace);
    };
    const checkAttr = (nameEvent, value) => {
      const { prefix, localName } = splitQualifiedName(nameEvent, qualifiedNameCache);
      const def = attlist == null ? void 0 : attlist.get(nameEvent.name);
      if (prefix === null && localName === "xmlns" && (!hasDeclarations || !ns._byPrefix.has(null))) {
        const namespace = normalizeAttributeValue(value, def, dtd, expansionGuard) || null;
        add(null, namespace, nameEvent);
      } else if (prefix === "xmlns" && (!hasDeclarations || !ns._byPrefix.has(localName))) {
        if (localName === "xmlns") {
          throwErrorWithContext(
            'the "xmlns" namespace prefix must not be declared',
            nameEvent
          );
        }
        const namespace = normalizeAttributeValue(value, def, dtd, expansionGuard) || null;
        add(localName, namespace, nameEvent);
      }
    };
    for (const attr of event.attributes) {
      checkAttr(attr.name, attr.value);
    }
    if (attlist) {
      for (const attr of attlist.values()) {
        const def = attr.def;
        if (def.type !== 2 /* VALUE */) {
          continue;
        }
        checkAttr(attr.name, def.value);
      }
    }
    return ns;
  }
  static default(resolve) {
    const ns = new _Namespaces(null, resolve);
    ns._byPrefix.set(null, null);
    ns._byPrefix.set("xml", XML_NAMESPACE);
    ns._byPrefix.set("xmlns", XMLNS_NAMESPACE);
    return ns;
  }
};
var ROOT_NAMESPACES = Namespaces.default(null);
function normalizeLineEndings(input) {
  return input.replace(/\r\n?/g, "\n");
}
function appendParsedNode(parent, child) {
  insertNode(child, parent, null, true);
}
var DEFAULT_ENTITY_EXPANSION_MAX_AMPLIFICATION = 100;
var DEFAULT_ENTITY_EXPANSION_THRESHOLD = 4194304;
function parseXml(input, generator, namespaces, into, {
  entityExpansionMaxAmplification = DEFAULT_ENTITY_EXPANSION_MAX_AMPLIFICATION,
  entityExpansionThreshold = DEFAULT_ENTITY_EXPANSION_THRESHOLD,
  treatCDataAsText = false
}) {
  var _a, _b;
  const doc = getNodeDocument(into);
  let domContext = {
    parent: null,
    root: into,
    namespaces,
    entityRoot: true
  };
  let dtd = null;
  const qualifiedNameCache = /* @__PURE__ */ new Map();
  let collectedText = [];
  function flushCollectedText() {
    if (collectedText.length > 0) {
      const text = collectedText.join("");
      if (domContext.root === doc) {
        if (!isWhitespace(text)) {
          throw new Error("document must not contain text outside of elements");
        }
      } else {
        appendParsedNode(domContext.root, doc.createTextNode(collectedText.join("")));
      }
      collectedText.length = 0;
    }
  }
  input = input.replace(/^\ufeff/, "");
  input = normalizeLineEndings(input);
  const expansionGuard = new EntityExpansionGuard(
    input.length,
    entityExpansionThreshold,
    entityExpansionMaxAmplification
  );
  let entityContext = {
    parent: null,
    entity: null,
    iterator: generator(input)
  };
  while (entityContext) {
    let it = entityContext.iterator.next();
    for (; !it.done; it = entityContext.iterator.next()) {
      const event = it.value;
      if (typeof event === "string") {
        collectedText.push(event);
        continue;
      }
      switch (event.type) {
        case 0 /* CharRef */:
          if (domContext.root === doc && doc.documentElement !== null) {
            throwErrorWithContext(
              "character reference must not appear after the document element",
              event
            );
          }
          collectedText.push(String.fromCodePoint(event.cp));
          continue;
        case 1 /* EntityRef */: {
          if (domContext.root === doc && doc.documentElement !== null) {
            throwErrorWithContext(
              `reference to entity "${event.name}" must not appear after the document element`,
              event
            );
          }
          for (let ctx = entityContext; ctx; ctx = ctx.parent) {
            if (ctx.entity === event.name) {
              throwErrorWithContext(
                `reference to entity "${event.name}" must not be recursive`,
                event
              );
            }
          }
          let replacementText = predefinedEntitiesReplacementText.get(event.name);
          if (replacementText === void 0 && dtd !== null) {
            replacementText = dtd.getEntityReplacementText(event, true);
          }
          if (replacementText === void 0) {
            throwErrorWithContext(
              `reference to unknown entity "${event.name}" in content`,
              event
            );
          }
          expansionGuard.enter(event, replacementText.length);
          domContext = {
            parent: domContext,
            root: domContext.root,
            namespaces: domContext.namespaces,
            entityRoot: true
          };
          entityContext = {
            parent: entityContext,
            entity: event.name,
            iterator: parseContent(replacementText)
          };
          continue;
        }
        case 5 /* CDSect */:
          if (treatCDataAsText) {
            collectedText.push(event.data);
            continue;
          }
          break;
      }
      flushCollectedText();
      switch (event.type) {
        case 5 /* CDSect */:
          if (domContext.root === doc && doc.documentElement !== null) {
            throwErrorWithContext(
              "CData section must not appear after the document element",
              event
            );
          }
          appendParsedNode(domContext.root, doc.createCDATASection(event.data));
          continue;
        case 3 /* Comment */:
          appendParsedNode(domContext.root, doc.createComment(event.data));
          continue;
        case 10 /* Doctypedecl */:
          dtd = new Dtd(event);
          appendParsedNode(
            domContext.root,
            doc.implementation.createDocumentType(
              event.name,
              ((_a = event.ids) == null ? void 0 : _a.publicId) || "",
              ((_b = event.ids) == null ? void 0 : _b.systemId) || ""
            )
          );
          continue;
        case 4 /* PI */:
          appendParsedNode(
            domContext.root,
            doc.createProcessingInstruction(event.target, event.data || "")
          );
          continue;
        case 7 /* STag */:
        case 9 /* EmptyElemTag */: {
          if (domContext.root === doc && doc.documentElement !== null) {
            throwErrorWithContext(
              `document must contain a single root element, but found "${doc.documentElement.nodeName}" and "${event.name.name}"`,
              event.name
            );
          }
          const attlist = dtd ? dtd.getAttlist(event.name) : void 0;
          const namespaces2 = Namespaces.fromAttrs(
            domContext.namespaces,
            event,
            attlist,
            dtd,
            qualifiedNameCache,
            expansionGuard
          );
          const { prefix, localName } = splitQualifiedName(
            event.name,
            qualifiedNameCache
          );
          const namespace = namespaces2.getForElement(prefix, event.name);
          const element2 = unsafeCreateElement(doc, localName, namespace, prefix);
          for (const attr of event.attributes) {
            const { prefix: prefix2, localName: localName2 } = splitQualifiedName(
              attr.name,
              qualifiedNameCache
            );
            const namespace2 = namespaces2.getForAttribute(prefix2, localName2, attr.name);
            const def = attlist == null ? void 0 : attlist.get(attr.name.name);
            if (element2.hasAttributeNS(namespace2, localName2)) {
              throwErrorWithContext(
                `attribute "${attr.name.name}" must not appear multiple times on element "${event.name.name}"`,
                attr.name
              );
            }
            const attrNode = unsafeCreateAttribute(
              namespace2,
              prefix2,
              localName2,
              normalizeAttributeValue(attr.value, def, dtd, expansionGuard),
              element2
            );
            appendAttribute(attrNode, element2, true);
          }
          if (attlist) {
            for (const attr of attlist.values()) {
              const def = attr.def;
              if (def.type !== 2 /* VALUE */) {
                continue;
              }
              const { prefix: prefix2, localName: localName2 } = splitQualifiedName(
                attr.name,
                qualifiedNameCache
              );
              const namespace2 = namespaces2.getForAttribute(
                prefix2,
                localName2,
                attr.name
              );
              if (element2.hasAttributeNS(namespace2, localName2)) {
                continue;
              }
              const attrNode = unsafeCreateAttribute(
                namespace2,
                prefix2,
                localName2,
                normalizeAttributeValue(def.value, attr, dtd, expansionGuard),
                element2
              );
              appendAttribute(attrNode, element2, true);
            }
          }
          appendParsedNode(domContext.root, element2);
          if (event.type === 7 /* STag */) {
            domContext = {
              parent: domContext,
              root: element2,
              namespaces: namespaces2,
              entityRoot: false,
              event
            };
          }
          continue;
        }
        case 8 /* ETag */:
          if (!isElement(domContext.root) || domContext.root.nodeName !== event.name) {
            throwErrorWithContext(
              `non-well-formed element: found end tag "${event.name}" but expected ${isElement(domContext.root) ? `"${domContext.root.nodeName}"` : "no such tag"}`,
              event
            );
          }
          domContext = domContext.parent;
          continue;
      }
    }
    if (!it.value.success) {
      throwParseError(
        entityContext.entity ? `replacement text for entity ${entityContext.entity}` : into === doc ? "document" : "fragment",
        input,
        it.value.expected,
        it.value.offset
      );
    }
    if (!domContext.entityRoot) {
      throwErrorWithContext(
        `${entityContext.entity ? `replacement text for entity "${entityContext.entity}"` : into === doc ? "document" : "fragment"} is not well-formed - element "${domContext.root.nodeName}" is missing a closing tag`,
        domContext.event.name
      );
    }
    entityContext = entityContext.parent;
    if (entityContext) {
      expansionGuard.exit();
      domContext = domContext.parent;
    }
  }
  flushCollectedText();
}
function parseXmlFragment(input, options = {}) {
  const doc = new Document();
  const fragment = doc.createDocumentFragment();
  parseXml(
    input,
    parseFragment,
    options.resolveNamespacePrefix ? Namespaces.default(options.resolveNamespacePrefix) : ROOT_NAMESPACES,
    fragment,
    options
  );
  return fragment;
}
function parseXmlDocument(input, options = {}) {
  const doc = new Document();
  parseXml(input, parseDocument, ROOT_NAMESPACES, doc, options);
  return doc;
}

// slimdom.js/src/dom-parsing/NamespacePrefixMap.ts
var NamespacePrefixMap = class _NamespacePrefixMap {
  constructor(parent) {
    this._nsByPrefix = /* @__PURE__ */ new Map();
    this._prefixCandidatesByNs = /* @__PURE__ */ new Map();
    this._parent = parent;
  }
  static new() {
    const map2 = new _NamespacePrefixMap(null);
    map2.add(null, null);
    map2.add("xml", XML_NAMESPACE);
    map2.add("xmlns", XMLNS_NAMESPACE);
    return map2;
  }
  /**
   * To add a prefix string prefix to the namespace prefix map map given a
   * namespace ns, the user agent should:
   *
   * @param prefix - The prefix to add
   * @param ns     - The namespace to add for prefix
   */
  add(prefix, ns) {
    const candidatesList = this._prefixCandidatesByNs.get(ns);
    if (candidatesList === void 0) {
      this._prefixCandidatesByNs.set(ns, [prefix]);
    } else {
      candidatesList.push(prefix);
    }
    this._nsByPrefix.set(prefix, ns);
  }
  recordNamespaceInformation(element2) {
    const map2 = new _NamespacePrefixMap(this);
    for (const attr of element2.attributes) {
      if (attr.namespaceURI !== XMLNS_NAMESPACE) {
        continue;
      }
      const namespaceUri = attr.value === "" ? null : attr.value;
      const definedPrefix = attr.prefix === null ? null : attr.localName;
      map2.add(definedPrefix, namespaceUri);
    }
    return map2;
  }
  _localPrefixToNamespace(prefix) {
    return this._nsByPrefix.get(prefix);
  }
  _inheritedPrefixToNamespace(prefix) {
    var _a;
    return (_a = this._parent) == null ? void 0 : _a.prefixToNamespace(prefix);
  }
  prefixToNamespace(prefix) {
    const ns = this._localPrefixToNamespace(prefix);
    if (ns !== void 0) {
      return ns;
    }
    return this._inheritedPrefixToNamespace(prefix);
  }
  shouldSerializeDeclaration(prefix, ns) {
    return this.prefixToNamespace(prefix) === ns && this._inheritedPrefixToNamespace(prefix) !== ns;
  }
  _getCandidatePrefix(namespaceUri, allowDefault) {
    let ancestor = this;
    while (ancestor) {
      const candidates = ancestor._prefixCandidatesByNs.get(namespaceUri);
      if (candidates !== void 0) {
        for (let i = candidates.length - 1; i >= 0; --i) {
          const candidate = candidates[i];
          if (!allowDefault && candidate === null) {
            continue;
          }
          if (this.prefixToNamespace(candidate) === namespaceUri) {
            return candidate;
          }
        }
      }
      ancestor = ancestor._parent;
    }
    return void 0;
  }
  getPreferredPrefix(node, prefixIndex) {
    var _a;
    if (node.namespaceURI === XML_NAMESPACE) {
      return "xml";
    }
    const isAttr = isAttrNode(node);
    if (node.namespaceURI === XMLNS_NAMESPACE) {
      if (isAttr && node.prefix === null) {
        return null;
      }
      return "xmlns";
    }
    if (isAttr && node.namespaceURI === null) {
      return null;
    }
    if (!isAttr) {
      let inheritedNs = (_a = this._inheritedPrefixToNamespace(null)) != null ? _a : null;
      if (node.namespaceURI === inheritedNs) {
        return null;
      }
    }
    if ((!isAttr || node.prefix !== null) && this.prefixToNamespace(node.prefix) === node.namespaceURI) {
      return node.prefix;
    }
    const candidatePrefix = this._getCandidatePrefix(node.namespaceURI, !isAttr);
    if (candidatePrefix !== void 0) {
      return candidatePrefix;
    }
    if (isAttr) {
      const namespaceForPrefix = this._localPrefixToNamespace(node.prefix);
      const isValidPrefix = node.prefix !== null && (namespaceForPrefix === void 0 || namespaceForPrefix === node.namespaceURI);
      if (!isValidPrefix) {
        while (true) {
          const generatedPrefix = `ns${prefixIndex.value}`;
          prefixIndex.value += 1;
          if (this._localPrefixToNamespace(generatedPrefix) === void 0) {
            return generatedPrefix;
          }
        }
      }
    }
    return node.prefix;
  }
};

// slimdom.js/src/dom-parsing/serializationAlgorithms.ts
var HTML_VOID_ELEMENTS = [
  "area",
  "base",
  "basefont",
  "bgsound",
  "br",
  "col",
  "embed",
  "frame",
  "hr",
  "img",
  "input",
  "keygen",
  "link",
  "menuitem",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
];
function serializeFragment(node, requireWellFormed, withFictionalParent = false) {
  const childNodes = withFictionalParent ? [node] : node.childNodes;
  const result = [];
  for (const child of childNodes) {
    produceXmlSerialization(child, requireWellFormed, result);
  }
  return result.join("");
}
function produceXmlSerialization(node, requireWellFormed, result) {
  const prefixMap = NamespacePrefixMap.new();
  const prefixIndex = { value: 1 };
  try {
    runXmlSerializationAlgorithm(node, prefixMap, prefixIndex, requireWellFormed, result);
  } catch (error2) {
    return throwInvalidStateError(error2.message);
  }
}
function runXmlSerializationAlgorithm(node, prefixMap, prefixIndex, requireWellFormed, result) {
  switch (node.nodeType) {
    // Element: Run the algorithm for XML serializing an Element node node.
    case 1 /* ELEMENT_NODE */:
      serializeElementNode(node, prefixMap, prefixIndex, requireWellFormed, result);
      return;
    // Document: Run the algorithm for XML serializing a Document node node.
    case 9 /* DOCUMENT_NODE */:
      serializeDocumentNode(node, prefixMap, prefixIndex, requireWellFormed, result);
      return;
    // Comment: Run the algorithm for XML serializing a Comment node node.
    case 8 /* COMMENT_NODE */:
      serializeCommentNode(node, requireWellFormed, result);
      return;
    // CDATASection: Run the algorithm for XML serializing a CDATASection node node.
    // Note: this is currently commented out in the DOM parsing spec, as it is based on the DOM4
    // spec which removed the CDATASection interface. It seems the interface has been restored
    // in the DOM living standard, so we'll implement its serialization as specced previously.
    case 4 /* CDATA_SECTION_NODE */:
      serializeCDATASectionNode(node, requireWellFormed, result);
      return;
    // Text: Run the algorithm for XML serializing a Text node node.
    case 3 /* TEXT_NODE */:
      serializeTextNode(node, requireWellFormed, result);
      return;
    // DocumentFragment: Run the algorithm for XML serializing a DocumentFragment node node.
    case 11 /* DOCUMENT_FRAGMENT_NODE */:
      serializeDocumentFragmentNode(node, prefixMap, prefixIndex, requireWellFormed, result);
      return;
    // DocumentType: Run the algorithm for XML serializing a DocumentType node node.
    case 10 /* DOCUMENT_TYPE_NODE */:
      serializeDocumentTypeNode(node, requireWellFormed, result);
      return;
    // ProcessingInstruction: Run the algorithm for XML serializing a ProcessingInstruction node
    // node.
    case 7 /* PROCESSING_INSTRUCTION_NODE */:
      serializeProcessingInstructionNode(node, requireWellFormed, result);
      return;
    // An Attr object: Return an empty string.
    case 2 /* ATTRIBUTE_NODE */:
      return;
    // Anything else: Throw a TypeError. Only Nodes and Attr objects can be serialized by this
    // algorithm.
    // (not reachable from public API)
    /* istanbul ignore next */
    default:
      throw new TypeError("Only Nodes and Attr objects can be serialized by this algorithm.");
  }
}
function serializeElementNode(node, prefixMap, prefixIndex, requireWellFormed, result) {
  const element2 = node;
  if (requireWellFormed && (element2.localName.indexOf(":") >= 0 || !matchesNameProduction(element2.localName))) {
    throw new Error(
      `Can not serialize an element because the localName "${element2.localName}" is not allowed.`
    );
  }
  result.push("<");
  let qualifiedName = "";
  let skipEndTag = false;
  const map2 = prefixMap.recordNamespaceInformation(element2);
  if (element2.prefix === "xmlns" && requireWellFormed) {
    throw new Error(
      'Can not serialize an element with prefix "xmlns" because it will not legally round-trip in a conforming XML parser.'
    );
  }
  const prefix = map2.getPreferredPrefix(element2, prefixIndex);
  if (prefix !== null) {
    qualifiedName += `${prefix}:`;
  }
  qualifiedName += element2.localName;
  result.push(qualifiedName);
  if (map2.prefixToNamespace(prefix) !== element2.namespaceURI) {
    map2.add(prefix, element2.namespaceURI);
    if (prefix === null) {
      result.push(' xmlns="');
    } else {
      result.push(" xmlns:", prefix, '="');
    }
    result.push(serializeAttributeValue(element2.namespaceURI, requireWellFormed), '"');
  }
  serializeAttributes(element2, map2, prefixIndex, requireWellFormed, result);
  if (element2.namespaceURI === HTML_NAMESPACE && !element2.hasChildNodes() && HTML_VOID_ELEMENTS.indexOf(element2.localName) >= 0) {
    result.push(" /");
    skipEndTag = true;
  }
  if (element2.namespaceURI !== HTML_NAMESPACE && !element2.hasChildNodes()) {
    result.push("/");
    skipEndTag = true;
  }
  result.push(">");
  if (skipEndTag) {
    return;
  }
  for (const child of node.childNodes) {
    runXmlSerializationAlgorithm(child, map2, prefixIndex, requireWellFormed, result);
  }
  result.push("</", qualifiedName, ">");
}
function serializeAttributes(element2, map2, prefixIndex, requireWellFormed, result) {
  const localNameSet = [];
  for (const attr of element2.attributes) {
    let prefix = map2.getPreferredPrefix(attr, prefixIndex);
    if (attr.namespaceURI === XMLNS_NAMESPACE) {
      const declaredNamespaceUri = attr.value === "" ? null : attr.value;
      if (requireWellFormed && declaredNamespaceUri === XMLNS_NAMESPACE) {
        throw new Error(
          "The serialization of this attribute would produce invalid XML because the XMLNS namespace is reserved and cannot be applied as an element's namespace via XML parsing."
        );
      }
      if (declaredNamespaceUri === XML_NAMESPACE || declaredNamespaceUri === XMLNS_NAMESPACE) {
        continue;
      }
      const declaredPrefix = attr.prefix === null ? null : attr.localName;
      if (requireWellFormed && attr.prefix !== null && attr.value === "") {
        throw new Error(
          "Namespace prefix declarations cannot be used to undeclare a namespace. Use a default namespace declaration instead."
        );
      }
      if (!map2.shouldSerializeDeclaration(declaredPrefix, declaredNamespaceUri)) {
        continue;
      }
    }
    if (requireWellFormed && localNameSet.find(
      (tuple) => tuple.localName === attr.localName && tuple.namespaceURI === attr.namespaceURI
    )) {
      throw new Error(
        `Can not serialize a duplicate attribute for namespaceURI "${attr.namespaceURI}", localName "${attr.localName}".`
      );
    }
    localNameSet.push({ namespaceURI: attr.namespaceURI, localName: attr.localName });
    if (requireWellFormed && (attr.localName.indexOf(":") >= 0 || !matchesNameProduction(attr.localName) || attr.localName === "xmlns" && attr.namespaceURI === null)) {
      throw new Error(
        `Can not serialize an attribute because the localName "${attr.localName}" is not allowed.`
      );
    }
    if (prefix !== null && map2.prefixToNamespace(prefix) !== attr.namespaceURI) {
      result.push(
        " xmlns:",
        prefix,
        '="',
        serializeAttributeValue(attr.namespaceURI, requireWellFormed),
        '"'
      );
      map2.add(prefix, attr.namespaceURI);
    }
    result.push(" ");
    if (prefix !== null) {
      result.push(prefix, ":");
    }
    result.push(
      attr.localName,
      '="',
      serializeAttributeValue(attr.value, requireWellFormed),
      '"'
    );
  }
}
function serializeAttributeValue(attributeValue, requireWellFormed) {
  if (requireWellFormed && attributeValue !== null && !matchesCharProduction(attributeValue)) {
    throw new Error(
      "Can not serialize an attribute value because it contains invalid characters."
    );
  }
  if (attributeValue === null) {
    return "";
  }
  return attributeValue.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\t/g, "&#9;").replace(/\n/g, "&#10;").replace(/\r/g, "&#13;");
}
function serializeDocumentNode(node, prefixMap, prefixIndex, requireWellFormed, result) {
  const document3 = node;
  if (requireWellFormed && document3.documentElement === null) {
    throw new Error("Can not serialize a document with no documentElement.");
  }
  for (const child of document3.childNodes) {
    runXmlSerializationAlgorithm(child, prefixMap, prefixIndex, requireWellFormed, result);
  }
}
function serializeCommentNode(node, requireWellFormed, result) {
  const comment = node;
  if (requireWellFormed && (!matchesCharProduction(comment.data) || comment.data.indexOf("--") >= 0 || comment.data.endsWith("-"))) {
    throw new Error("Can not serialize a comment because it contains invalid characters.");
  }
  result.push("<!--", comment.data, "-->");
}
function serializeCDATASectionNode(node, requireWellFormed, result) {
  const cs = node;
  result.push("<![CDATA[", cs.data, "]]>");
}
function serializeTextNode(node, requireWellFormed, result) {
  const text = node;
  if (requireWellFormed && !matchesCharProduction(text.data)) {
    throw new Error("Can not serialize a text node because it contains invalid characters.");
  }
  let markup = text.data;
  markup = markup.replace(/&/g, "&amp;");
  markup = markup.replace(/</g, "&lt;");
  markup = markup.replace(/>/g, "&gt;");
  result.push(markup);
}
function serializeDocumentFragmentNode(node, prefixMap, prefixIndex, requireWellFormed, result) {
  for (const child of node.childNodes) {
    runXmlSerializationAlgorithm(child, prefixMap, prefixIndex, requireWellFormed, result);
  }
}
function serializeDocumentTypeNode(node, requireWellFormed, result) {
  const dt = node;
  if (requireWellFormed && !matchesPubidCharProduction(dt.publicId)) {
    throw new Error(
      "Can not serialize a document type because the publicId contains invalid characters."
    );
  }
  if (requireWellFormed && (!matchesCharProduction(dt.systemId) || dt.systemId.indexOf('"') >= 0 && dt.systemId.indexOf("'") >= 0)) {
    throw new Error(
      "Can not serialize a document type because the systemId contains invalid characters."
    );
  }
  result.push("<!DOCTYPE");
  result.push(" ");
  result.push(dt.name);
  if (dt.publicId !== "") {
    result.push(' PUBLIC "', dt.publicId, '"');
  }
  if (dt.systemId !== "" && dt.publicId === "") {
    result.push(" SYSTEM");
  }
  if (dt.systemId !== "") {
    result.push(' "', dt.systemId, '"');
  }
  result.push(">");
}
function serializeProcessingInstructionNode(node, requireWellFormed, result) {
  const pi = node;
  if (requireWellFormed) {
    if (pi.target.indexOf(":") >= 0) {
      throw new Error(
        `Can not serialize a processing instruction because the target "${pi.target}" may not contain ":".`
      );
    }
    if (pi.target.toLowerCase() === "xml") {
      throw new Error(
        'Can not serialize a processing instruction because "xml" may not be used as target.'
      );
    }
  }
  if (requireWellFormed && (!matchesCharProduction(pi.data) || pi.data.indexOf("?>") >= 0)) {
    throw new Error(
      "Can not serialize a processing instruction because the data contains invalid characters."
    );
  }
  result.push("<?", pi.target, " ", pi.data, "?>");
}

// slimdom.js/src/Element.ts
var Element2 = class extends Node {
  /**
   * (non-standard) Use Document#createElement or Document#createElementNS to create an Element.
   *
   * @param namespace - Namespace for the element
   * @param prefix    - Prefix for the element
   * @param localName - Local name for the element
   */
  constructor(namespace, prefix, localName) {
    super();
    this.firstElementChild = null;
    this.lastElementChild = null;
    this.childElementCount = 0;
    /**
     * The attributes for the element.
     *
     * Non-standard: the spec defines this as a NamedNodeMap, while this implementation uses an
     * array.
     */
    this.attributes = [];
    this.namespaceURI = namespace;
    this.prefix = prefix;
    this.localName = localName;
    this.tagName = prefix === null ? localName : `${prefix}:${localName}`;
  }
  // Node
  get nodeType() {
    return 1 /* ELEMENT_NODE */;
  }
  get nodeName() {
    return this.tagName;
  }
  get nodeValue() {
    return null;
  }
  set nodeValue(newValue) {
  }
  get textContent() {
    return getDescendantTextContent(this);
  }
  set textContent(newValue) {
    newValue = ifNullActAsIfEmptyString(newValue);
    stringReplaceAll(this, newValue);
  }
  lookupPrefix(namespace) {
    expectArity(arguments, 1);
    namespace = asNullableString(namespace);
    if (namespace === null || namespace === "") {
      return null;
    }
    return locateNamespacePrefix(this, namespace);
  }
  lookupNamespaceURI(prefix) {
    expectArity(arguments, 1);
    prefix = asNullableString(prefix);
    if (prefix === "") {
      prefix = null;
    }
    if (this.namespaceURI !== null && this.prefix === prefix) {
      return this.namespaceURI;
    }
    let ns = null;
    if (prefix !== null) {
      const attr = this.getAttributeNodeNS(XMLNS_NAMESPACE, prefix);
      if (attr && attr.prefix === "xmlns") {
        ns = attr.value;
      }
    } else {
      const attr = this.getAttributeNodeNS(XMLNS_NAMESPACE, "xmlns");
      if (attr && attr.prefix === null) {
        ns = attr.value;
      }
    }
    if (ns !== null) {
      return ns !== "" ? ns : null;
    }
    const parentElement = this.parentElement;
    if (parentElement === null) {
      return null;
    }
    return parentElement.lookupNamespaceURI(prefix);
  }
  // ChildNode
  before(...nodes) {
    insertNodesBefore(this, nodes);
  }
  after(...nodes) {
    insertNodesAfter(this, nodes);
  }
  replaceWith(...nodes) {
    replaceWithNodes(this, nodes);
  }
  remove() {
    removeFromParent(this);
  }
  // ParentNode
  get children() {
    return getChildren(this);
  }
  prepend(...nodes) {
    prependNodes(this, nodes);
  }
  append(...nodes) {
    appendNodes(this, nodes);
  }
  replaceChildren(...nodes) {
    replaceChildren(this, nodes);
  }
  // NonDocumentTypeChildNode
  get previousElementSibling() {
    return getPreviousElementSibling(this);
  }
  get nextElementSibling() {
    return getNextElementSibling(this);
  }
  /**
   * Returns whether the element has any attributes.
   *
   * @returns True if the element has attributes, otherwise false
   */
  hasAttributes() {
    return this.attributes.length > 0;
  }
  /**
   * Get the value of the specified attribute.
   *
   * @param qualifiedName - The qualified name of the attribute
   *
   * @returns The value of the attribute, or null if no such attribute exists
   */
  getAttribute(qualifiedName) {
    expectArity(arguments, 1);
    qualifiedName = String(qualifiedName);
    const attr = getAttributeByName(qualifiedName, this);
    if (attr === null) {
      return null;
    }
    return attr.value;
  }
  /**
   * Get the value of the specified attribute.
   *
   * @param namespace - The namespace of the attribute
   * @param localName - The local name of the attribute
   *
   * @returns The value of the attribute, or null if no such attribute exists
   */
  getAttributeNS(namespace, localName) {
    expectArity(arguments, 2);
    namespace = asNullableString(namespace);
    localName = String(localName);
    const attr = getAttributeByNamespaceAndLocalName(namespace, localName, this);
    if (attr === null) {
      return null;
    }
    return attr.value;
  }
  /**
   * Sets the value of the specified attribute.
   *
   * @param qualifiedName - The qualified name of the attribute
   * @param value         - The new value for the attribute
   */
  setAttribute(qualifiedName, value) {
    expectArity(arguments, 2);
    qualifiedName = String(qualifiedName);
    value = String(value);
    if (!matchesNameProduction(qualifiedName)) {
      throwInvalidCharacterError("The qualified name does not match the Name production");
    }
    const attribute = getAttributeByName(qualifiedName, this);
    if (attribute === null) {
      const context = getContext(this);
      const attribute2 = new context.Attr(null, null, qualifiedName, value, this);
      attribute2.ownerDocument = this.ownerDocument;
      appendAttribute(attribute2, this);
      return;
    }
    changeAttribute(attribute, value);
  }
  /**
   * Sets the value of the specified attribute.
   *
   * @param namespace     - The namespace of the attribute
   * @param qualifiedName - The qualified name of the attribute
   * @param value         - The value for the attribute
   */
  setAttributeNS(namespace, qualifiedName, value) {
    expectArity(arguments, 3);
    namespace = asNullableString(namespace);
    qualifiedName = String(qualifiedName);
    value = String(value);
    const {
      namespace: validatedNamespace,
      prefix,
      localName
    } = validateAndExtract(namespace, qualifiedName);
    setAttributeValue(this, localName, value, prefix, validatedNamespace);
  }
  /**
   * Removes the specified attribute.
   *
   * @param qualifiedName - The qualified name of the attribute
   */
  removeAttribute(qualifiedName) {
    expectArity(arguments, 1);
    qualifiedName = String(qualifiedName);
    removeAttributeByName(qualifiedName, this);
  }
  /**
   * Removes the specified attribute.
   *
   * @param namespace - The namespace of the attribute
   * @param localName - The local name of the attribute
   */
  removeAttributeNS(namespace, localName) {
    expectArity(arguments, 2);
    namespace = asNullableString(namespace);
    localName = String(localName);
    removeAttributeByNamespaceAndLocalName(namespace, localName, this);
  }
  /**
   * If force is not given, "toggles" qualifiedName, removing it if it is present and adding it if
   * it is not present. If force is true, adds qualifiedName. If force is false, removes
   * qualifiedName.
   *
   * Returns true if qualifiedName is now present, and false otherwise.
   *
   * @param qualifiedName - The qualified name of the attribute to toggle
   * @param force         - If true, adds the attribute, if false removes it
   */
  toggleAttribute(qualifiedName, force) {
    if (!matchesNameProduction(qualifiedName)) {
      throwInvalidCharacterError("The qualified name does not match the Name production");
    }
    const attribute = getAttributeByName(qualifiedName, this);
    if (attribute === null) {
      if (force === void 0 || force === true) {
        const context = getContext(this);
        const attribute2 = new context.Attr(null, null, qualifiedName, "", this);
        attribute2.ownerDocument = this.ownerDocument;
        appendAttribute(attribute2, this);
        return true;
      }
      return false;
    }
    if (force === void 0 || force === false) {
      removeAttributeByName(qualifiedName, this);
      return false;
    }
    return true;
  }
  /**
   * Returns true if the specified attribute exists and false otherwise.
   *
   * @param qualifiedName - The qualified name of the attribute
   */
  hasAttribute(qualifiedName) {
    expectArity(arguments, 1);
    qualifiedName = String(qualifiedName);
    return getAttributeByName(qualifiedName, this) !== null;
  }
  /**
   * Returns true if the specified attribute exists and false otherwise.
   *
   * @param namespace - The namespace of the attribute
   * @param localName - The local name of the attribute
   */
  hasAttributeNS(namespace, localName) {
    expectArity(arguments, 2);
    namespace = asNullableString(namespace);
    localName = String(localName);
    return getAttributeByNamespaceAndLocalName(namespace, localName, this) !== null;
  }
  /**
   * Returns the specified attribute node, or null if no such attribute exists.
   *
   * @param qualifiedName - The qualified name of the attribute
   *
   * @returns The attribute, or null if no such attribute exists
   */
  getAttributeNode(qualifiedName) {
    expectArity(arguments, 1);
    qualifiedName = String(qualifiedName);
    return getAttributeByName(qualifiedName, this);
  }
  /**
   * Returns the specified attribute node, or null if no such attribute exists.
   *
   * @param namespace - The namespace of the attribute
   * @param localName - The local name of the attribute
   *
   * @returns The attribute, or null if no such attribute exists
   */
  getAttributeNodeNS(namespace, localName) {
    expectArity(arguments, 2);
    namespace = asNullableString(namespace);
    localName = String(localName);
    return getAttributeByNamespaceAndLocalName(namespace, localName, this);
  }
  /**
   * Sets an attribute given its node
   *
   * @param attr - The attribute node to set
   *
   * @returns The previous attribute node for the attribute
   */
  setAttributeNode(attr) {
    expectArity(arguments, 1);
    attr = asObject(attr, Attr);
    return setAttribute(attr, this);
  }
  /**
   * Sets an attribute given its node
   *
   * @param attr - The attribute node to set
   *
   * @returns The previous attribute node for the attribute
   */
  setAttributeNodeNS(attr) {
    expectArity(arguments, 1);
    attr = asObject(attr, Attr);
    return setAttribute(attr, this);
  }
  /**
   * Removes an attribute given its node
   *
   * @param attr - The attribute node to remove
   *
   * @returns The removed attribute node
   */
  removeAttributeNode(attr) {
    expectArity(arguments, 1);
    attr = asObject(attr, Attr);
    if (this.attributes.indexOf(attr) < 0) {
      throwNotFoundError("the specified attribute does not exist");
    }
    removeAttribute(attr);
    return attr;
  }
  /**
   * Returns the list of elements with the given qualified name.
   *
   * @param qualifiedName - Qualified name of the elements to collect.
   *
   * @returns  The list of elements with matching qualified name.
   */
  getElementsByTagName(qualifiedName) {
    expectArity(arguments, 1);
    qualifiedName = String(qualifiedName);
    return getListOfElementsWithQualifiedName(qualifiedName, this);
  }
  /**
   * Returns the list of elements with the given namespace and local name.
   *
   * @param namespace - Namespace URI of the elements to collect.
   * @param localName - Local name of the elements to collect
   *
   * @returns  The list of elements with matching namespace and local name.
   */
  getElementsByTagNameNS(namespace, localName) {
    expectArity(arguments, 2);
    namespace = asNullableString(namespace);
    localName = String(localName);
    return getListOfElementsWithNamespaceAndLocalName(namespace, localName, this);
  }
  /**
   * (non-standard) Creates a copy of the given node
   *
   * @param document - The node document to associate with the copy
   * @param other    - The node to copy
   *
   * @returns A shallow copy of the node
   */
  _copy(document3) {
    const copyElement = createElement(document3, this.localName, this.namespaceURI, this.prefix);
    for (const attr of this.attributes) {
      const copyAttribute = attr._copy(document3);
      copyElement.setAttributeNode(copyAttribute);
    }
    return copyElement;
  }
  // From the DOM Parsing and Serialization spec
  /**
   * Returns a fragment of HTML or XML that represents the element's contents.
   */
  get innerHTML() {
    return serializeFragment(this, true);
  }
  /**
   * Returns a fragment of HTML or XML that represents the element and its contents.
   */
  get outerHTML() {
    return serializeFragment(this, true, true);
  }
};
function createElement(document3, localName, namespace, prefix = null) {
  let result = null;
  const context = getContext(document3);
  result = new context.Element(namespace, prefix, localName);
  result.ownerDocument = document3;
  return result;
}
function getAttributeByName(qualifiedName, element2) {
  return element2.attributes.find((attr) => attr.name === qualifiedName) || null;
}
function getAttributeByNamespaceAndLocalName(namespace, localName, element2) {
  if (namespace === "") {
    namespace = null;
  }
  return element2.attributes.find(
    (attr) => attr.namespaceURI === namespace && attr.localName === localName
  ) || null;
}
function setAttribute(attr, element2) {
  if (attr.ownerElement !== null && attr.ownerElement !== element2) {
    throwInUseAttributeError("attribute is in use by another element");
  }
  const oldAttr = getAttributeByNamespaceAndLocalName(attr.namespaceURI, attr.localName, element2);
  if (oldAttr === attr) {
    return attr;
  }
  if (oldAttr !== null) {
    replaceAttribute(oldAttr, attr);
  } else {
    appendAttribute(attr, element2);
  }
  return oldAttr;
}
function setAttributeValue(element2, localName, value, prefix, namespace) {
  const attribute = getAttributeByNamespaceAndLocalName(namespace, localName, element2);
  if (attribute === null) {
    const context = getContext(element2);
    const attribute2 = new context.Attr(namespace, prefix, localName, value, element2);
    attribute2.ownerDocument = element2.ownerDocument;
    appendAttribute(attribute2, element2);
    return;
  }
  changeAttribute(attribute, value);
}
function removeAttributeByName(qualifiedName, element2) {
  const attr = getAttributeByName(qualifiedName, element2);
  if (attr !== null) {
    removeAttribute(attr);
  }
  return attr;
}
function removeAttributeByNamespaceAndLocalName(namespace, localName, element2) {
  const attr = getAttributeByNamespaceAndLocalName(namespace, localName, element2);
  if (attr !== null) {
    removeAttribute(attr);
  }
  return attr;
}

// slimdom.js/src/util/createElementNS.ts
function createElementNS(document3, namespace, qualifiedName) {
  const {
    namespace: validatedNamespace,
    prefix,
    localName
  } = validateAndExtract(namespace, qualifiedName);
  const element2 = createElement(document3, localName, validatedNamespace, prefix);
  return element2;
}

// slimdom.js/src/DOMImplementation.ts
var DOMImplementation = class {
  /**
   * (non-standard) Use Document#implementation to access instances of this class
   *
   * @param document - The document to associate with this instance
   */
  constructor(document3) {
    this._document = document3;
  }
  /**
   * Returns a doctype, with the given qualifiedName, publicId, and systemId.
   *
   * @param qualifiedName - Qualified name for the doctype
   * @param publicId      - Public ID for the doctype
   * @param systemId      - System ID for the doctype
   *
   * @returns The new doctype node
   */
  createDocumentType(qualifiedName, publicId, systemId) {
    expectArity(arguments, 3);
    qualifiedName = String(qualifiedName);
    publicId = String(publicId);
    systemId = String(systemId);
    validateQualifiedName(qualifiedName);
    const context = getContext(this._document);
    const doctype = new context.DocumentType(qualifiedName, publicId, systemId);
    doctype.ownerDocument = this._document;
    return doctype;
  }
  /**
   * Returns an XMLDocument, with a document element whose local name is qualifiedName and whose
   * namespace is namespace (unless qualifiedName is the empty string), and with doctype, if it is
   * given, as its doctype.
   *
   * @param namespace     - The namespace for the root element
   * @param qualifiedName - The qualified name for the root element, or empty string to not create
   *                        a root element
   * @param doctype       - The doctype for the new document, or null to not add a doctype
   *
   * @returns The new XMLDocument
   */
  createDocument(namespace, qualifiedName, doctype = null) {
    expectArity(arguments, 2);
    namespace = asNullableString(namespace);
    qualifiedName = legacyNullToEmptyString(qualifiedName);
    doctype = asNullableObject(doctype, DocumentType);
    const context = getContext(this._document);
    const document3 = new context.XMLDocument();
    let element2 = null;
    if (qualifiedName !== "") {
      element2 = createElementNS(document3, namespace, qualifiedName);
    }
    if (doctype) {
      document3.appendChild(doctype);
    }
    if (element2) {
      document3.appendChild(element2);
    }
    return document3;
  }
  /**
   * Returns a HTML document with a basic tree already constructed.
   *
   * @param title - Optional title for the new HTML document
   *
   * @returns The new document
   */
  createHTMLDocument(title) {
    title = asNullableString(title);
    const context = getContext(this._document);
    const doc = new context.Document();
    const doctype = new context.DocumentType("html");
    doctype.ownerDocument = doc;
    doc.appendChild(doctype);
    const htmlElement = createElement(doc, "html", HTML_NAMESPACE);
    doc.appendChild(htmlElement);
    const headElement = createElement(doc, "head", HTML_NAMESPACE);
    htmlElement.appendChild(headElement);
    if (title !== null) {
      const titleElement = createElement(doc, "title", HTML_NAMESPACE);
      headElement.appendChild(titleElement);
      titleElement.appendChild(doc.createTextNode(title));
    }
    htmlElement.appendChild(createElement(doc, "body", HTML_NAMESPACE));
    return doc;
  }
};

// slimdom.js/src/Document.ts
var Document = class extends Node {
  /**
   * Creates a new Document.
   *
   * Note: Unlike DOMImplementation#createDocument(), this constructor does not return an
   * XMLDocument object, but a document (Document object).
   */
  constructor() {
    super();
    this.firstElementChild = null;
    this.lastElementChild = null;
    this.childElementCount = 0;
    // Document
    /**
     * Returns a reference to the DOMImplementation object associated with the document.
     */
    this.implementation = new DOMImplementation(this);
    /**
     * The doctype, or null if there is none.
     */
    this.doctype = null;
    /**
     * The document element, or null if there is none.
     */
    this.documentElement = null;
  }
  // Node
  get nodeType() {
    return 9 /* DOCUMENT_NODE */;
  }
  get nodeName() {
    return "#document";
  }
  get nodeValue() {
    return null;
  }
  set nodeValue(_newValue) {
  }
  get textContent() {
    return null;
  }
  set textContent(_newValue) {
  }
  lookupPrefix(namespace) {
    expectArity(arguments, 1);
    if (this.documentElement !== null) {
      return this.documentElement.lookupPrefix(namespace);
    }
    return null;
  }
  lookupNamespaceURI(prefix) {
    expectArity(arguments, 1);
    if (this.documentElement === null) {
      return null;
    }
    return this.documentElement.lookupNamespaceURI(prefix);
  }
  // ParentNode
  get children() {
    return getChildren(this);
  }
  prepend(...nodes) {
    prependNodes(this, nodes);
  }
  append(...nodes) {
    appendNodes(this, nodes);
  }
  replaceChildren(...nodes) {
    replaceChildren(this, nodes);
  }
  /**
   * Returns the list of elements with the given qualified name.
   *
   * @param qualifiedName - Qualified name of the elements to collect.
   *
   * @returns  The list of elements with matching qualified name.
   */
  getElementsByTagName(qualifiedName) {
    expectArity(arguments, 1);
    qualifiedName = String(qualifiedName);
    return getListOfElementsWithQualifiedName(qualifiedName, this);
  }
  /**
   * Returns the list of elements with the given namespace and local name.
   *
   * @param namespace - Namespace URI of the elements to collect.
   * @param localName - Local name of the elements to collect
   *
   * @returns  The list of elements with matching namespace and local name.
   */
  getElementsByTagNameNS(namespace, localName) {
    expectArity(arguments, 2);
    namespace = asNullableString(namespace);
    localName = String(localName);
    return getListOfElementsWithNamespaceAndLocalName(namespace, localName, this);
  }
  /**
   * Creates a new element in the null namespace.
   *
   * @param localName - Local name of the element
   *
   * @returns The new element
   */
  createElement(localName) {
    expectArity(arguments, 1);
    localName = String(localName);
    if (!matchesNameProduction(localName)) {
      throwInvalidCharacterError("The local name is not a valid Name");
    }
    const namespace = null;
    const element2 = createElement(this, localName, namespace, null);
    return element2;
  }
  /**
   * Creates a new element in the given namespace.
   *
   * @param namespace     - Namespace URI for the new element
   * @param qualifiedName - Qualified name for the new element
   *
   * @returns The new element
   */
  createElementNS(namespace, qualifiedName) {
    expectArity(arguments, 2);
    namespace = asNullableString(namespace);
    qualifiedName = String(qualifiedName);
    return createElementNS(this, namespace, qualifiedName);
  }
  /**
   * Returns a new DocumentFragment node with its node document set to this.
   *
   * @returns The new document fragment
   */
  createDocumentFragment() {
    const context = getContext(this);
    const documentFragment = new context.DocumentFragment();
    documentFragment.ownerDocument = this;
    return documentFragment;
  }
  /**
   * Returns a new Text node with its data set to data and node document set to this.
   *
   * @param data - Data for the new text node
   *
   * @returns The new text node
   */
  createTextNode(data) {
    expectArity(arguments, 1);
    data = String(data);
    const context = getContext(this);
    const text = new context.Text(data);
    text.ownerDocument = this;
    return text;
  }
  /**
   * Returns a new CDATA section with the given data and node document set to this.
   *
   * @param data - Data for the new CDATA section
   *
   * @returns The new CDATA section
   */
  createCDATASection(data) {
    expectArity(arguments, 1);
    data = String(data);
    if (data.indexOf("]]>") >= 0) {
      throwInvalidCharacterError('Data must not contain the string "]]>"');
    }
    const context = getContext(this);
    const cdataSection = new context.CDATASection(data);
    cdataSection.ownerDocument = this;
    return cdataSection;
  }
  /**
   * Returns a new Comment node with its data set to data and node document set to this.
   *
   * @param data - Data for the new comment
   *
   * @returns The new comment node
   */
  createComment(data) {
    expectArity(arguments, 1);
    data = String(data);
    const context = getContext(this);
    const comment = new context.Comment(data);
    comment.ownerDocument = this;
    return comment;
  }
  /**
   * Creates a new processing instruction node, with target set to target, data set to data, and
   * node document set to this.
   *
   * @param target - Target for the new processing instruction
   * @param data   - Data for the new processing instruction
   *
   * @returns The new processing instruction
   */
  createProcessingInstruction(target, data) {
    expectArity(arguments, 2);
    target = String(target);
    data = String(data);
    if (!matchesNameProduction(target)) {
      throwInvalidCharacterError("The target is not a valid Name");
    }
    if (data.indexOf("?>") >= 0) {
      throwInvalidCharacterError('Data must not contain the string "?>"');
    }
    const context = getContext(this);
    const pi = new context.ProcessingInstruction(target, data);
    pi.ownerDocument = this;
    return pi;
  }
  /**
   * Creates a copy of a node from an external document that can be inserted into the current
   * document.
   *
   * @param node - The node to import
   * @param deep - Whether to also import node's children
   */
  importNode(node, deep = false) {
    expectArity(arguments, 1);
    node = asObject(node, Node);
    if (isNodeOfType(node, 9 /* DOCUMENT_NODE */)) {
      throwNotSupportedError("importing a Document node is not supported");
    }
    return cloneNode(node, deep, this);
  }
  /**
   * Adopts a node. The node and its subtree is removed from the document it's in (if any), and
   * its ownerDocument is changed to the current document. The node can then be inserted into the
   * current document.
   *
   * @param node - The node to adopt
   */
  adoptNode(node) {
    expectArity(arguments, 1);
    node = asObject(node, Node);
    if (isNodeOfType(node, 9 /* DOCUMENT_NODE */)) {
      throwNotSupportedError("adopting a Document node is not supported");
    }
    adoptNode(node, this);
    return node;
  }
  /**
   * Creates a new attribute node with the null namespace and given local name.
   *
   * @param localName - The local name of the attribute
   *
   * @returns The new attribute node
   */
  createAttribute(localName) {
    expectArity(arguments, 1);
    localName = String(localName);
    if (!matchesNameProduction(localName)) {
      throwInvalidCharacterError("The local name is not a valid Name");
    }
    const context = getContext(this);
    const attr = new context.Attr(null, null, localName, "", null);
    attr.ownerDocument = this;
    return attr;
  }
  /**
   * Creates a new attribute node with the given namespace and qualified name.
   *
   * @param namespace     - Namespace URI for the new attribute, or null for the null namespace
   * @param qualifiedName - Qualified name for the new attribute
   *
   * @returns The new attribute node
   */
  createAttributeNS(namespace, qualifiedName) {
    expectArity(arguments, 2);
    namespace = asNullableString(namespace);
    qualifiedName = String(qualifiedName);
    const {
      namespace: validatedNamespace,
      prefix,
      localName
    } = validateAndExtract(namespace, qualifiedName);
    const context = getContext(this);
    const attr = new context.Attr(validatedNamespace, prefix, localName, "", null);
    attr.ownerDocument = this;
    return attr;
  }
  /**
   * Creates a new live Range, initially positioned at the root of this document.
   *
   * @returns The new Range
   */
  createRange() {
    const context = getContext(this);
    const range2 = new context.Range();
    range2.startContainer = this;
    range2.startOffset = 0;
    range2.endContainer = this;
    range2.endOffset = 0;
    return range2;
  }
  /**
   * (non-standard) Creates a copy of this, not including its children.
   *
   * @param document - The node document to associate with the copy
   *
   * @returns A shallow copy of this
   */
  _copy(document3) {
    const context = getContext(document3);
    return new context.Document();
  }
};

// slimdom.js/src/DocumentFragment.ts
var DocumentFragment = class extends Node {
  /**
   * Return a new DocumentFragment node whose node document is current global object’s associated
   * Document.
   */
  constructor() {
    super();
    this.firstElementChild = null;
    this.lastElementChild = null;
    this.childElementCount = 0;
    const context = getContext(this);
    this.ownerDocument = context.document;
  }
  // Node
  get nodeType() {
    return 11 /* DOCUMENT_FRAGMENT_NODE */;
  }
  get nodeName() {
    return "#document-fragment";
  }
  get nodeValue() {
    return null;
  }
  set nodeValue(newValue) {
  }
  get textContent() {
    return getDescendantTextContent(this);
  }
  set textContent(newValue) {
    newValue = ifNullActAsIfEmptyString(newValue);
    stringReplaceAll(this, newValue);
  }
  lookupPrefix(namespace) {
    expectArity(arguments, 1);
    return null;
  }
  lookupNamespaceURI(prefix) {
    expectArity(arguments, 1);
    return null;
  }
  // ParentNode
  get children() {
    return getChildren(this);
  }
  prepend(...nodes) {
    prependNodes(this, nodes);
  }
  append(...nodes) {
    appendNodes(this, nodes);
  }
  replaceChildren(...nodes) {
    replaceChildren(this, nodes);
  }
  /**
   * (non-standard) Creates a copy of this, not including its children.
   *
   * @param document - The node document to associate with the copy
   *
   * @returns A shallow copy of this
   */
  _copy(document3) {
    const context = getContext(document3);
    const copy = new context.DocumentFragment();
    copy.ownerDocument = document3;
    return copy;
  }
};

// slimdom.js/src/ProcessingInstruction.ts
var ProcessingInstruction = class extends CharacterData {
  // Node
  get nodeType() {
    return 7 /* PROCESSING_INSTRUCTION_NODE */;
  }
  get nodeName() {
    return this.target;
  }
  /**
   * (non-standard) Use Document#createProcessingInstruction to create a processing instruction.
   *
   * @param target - The target of the processing instruction
   * @param data   - The data of the processing instruction
   */
  constructor(target, data) {
    super(data);
    this.target = target;
  }
  /**
   * (non-standard) Creates a copy of this, not including its children.
   *
   * @param document - The node document to associate with the copy
   *
   * @returns A shallow copy of this
   */
  _copy(document3) {
    const context = getContext(document3);
    const copy = new context.ProcessingInstruction(this.target, this.data);
    copy.ownerDocument = document3;
    return copy;
  }
};

// slimdom.js/src/Range.ts
var StaticRange = class {
  /**
   * The StaticRange(init) constructor, when invoked, must run these steps:
   *
   * @param init - Dictionary representing the properties to set on the StaticRange
   */
  constructor(init) {
    if (isNodeOfType(init.startContainer, 10 /* DOCUMENT_TYPE_NODE */, 2 /* ATTRIBUTE_NODE */)) {
      throwInvalidNodeTypeError(
        "StaticRange startContainer must not be a doctype or attribute node"
      );
    }
    if (isNodeOfType(init.endContainer, 10 /* DOCUMENT_TYPE_NODE */, 2 /* ATTRIBUTE_NODE */)) {
      throwInvalidNodeTypeError(
        "StaticRange endContainer must not be a doctype or attribute node"
      );
    }
    this.startContainer = init.startContainer;
    this.startOffset = init.startOffset;
    this.endContainer = init.endContainer;
    this.endOffset = init.endOffset;
    this.collapsed = this.startContainer === this.endContainer && this.startOffset === this.endOffset;
  }
};
function isCollapsed(range2) {
  return range2.startContainer === range2.endContainer && range2.startOffset === range2.endOffset;
}
function forEachNodeContainedInRange(range2, callback) {
  if (range2.collapsed) {
    return;
  }
  const ancestors1 = getInclusiveAncestors(range2.startContainer);
  const ancestors2 = getInclusiveAncestors(range2.endContainer);
  let firstDistinctAncestorIndex = 0;
  while (firstDistinctAncestorIndex < ancestors1.length && firstDistinctAncestorIndex < ancestors2.length) {
    if (ancestors1[firstDistinctAncestorIndex] !== ancestors2[firstDistinctAncestorIndex]) {
      break;
    }
    ++firstDistinctAncestorIndex;
  }
  const firstChildOutside = range2.endContainer.childNodes[range2.endOffset] || null;
  for (let child = range2.startContainer.childNodes[range2.startOffset] || null; child && child !== firstChildOutside && child !== ancestors2[ancestors1.length]; child = child.nextSibling) {
    callback(child);
  }
  for (let i = ancestors1.length - 1; i >= firstDistinctAncestorIndex; --i) {
    for (let sibling = ancestors1[i].nextSibling; sibling && sibling !== firstChildOutside && sibling !== ancestors2[i]; sibling = sibling.nextSibling) {
      callback(sibling);
    }
  }
  for (let i = firstDistinctAncestorIndex; i < ancestors2.length; ++i) {
    for (let child = ancestors2[i].firstChild; child && child !== firstChildOutside && child !== ancestors2[i + 1]; child = child.nextSibling) {
      callback(child);
    }
  }
}
function extractRange(range2, isClone) {
  const document3 = getNodeDocument(range2.startContainer);
  const fragment = document3.createDocumentFragment();
  if (range2.collapsed) {
    return fragment;
  }
  const originalStartNode = range2.startContainer;
  const originalStartOffset = range2.startOffset;
  const originalEndNode = range2.endContainer;
  const originalEndOffset = range2.endOffset;
  if (originalStartNode === originalEndNode && isCharacterDataNode(originalStartNode)) {
    const clone = originalStartNode.cloneNode();
    clone.data = originalStartNode.substringData(
      originalStartOffset,
      originalEndOffset - originalStartOffset
    );
    appendNode(clone, fragment);
    if (!isClone) {
      originalStartNode.replaceData(
        originalStartOffset,
        originalEndOffset - originalStartOffset,
        ""
      );
    }
    return fragment;
  }
  const ancestors1 = getInclusiveAncestors(range2.startContainer);
  const ancestors2 = getInclusiveAncestors(range2.endContainer);
  let firstDistinctAncestorIndex = 0;
  while (firstDistinctAncestorIndex < ancestors1.length && firstDistinctAncestorIndex < ancestors2.length) {
    if (ancestors1[firstDistinctAncestorIndex] !== ancestors2[firstDistinctAncestorIndex]) {
      break;
    }
    ++firstDistinctAncestorIndex;
  }
  const startContainsEnd = firstDistinctAncestorIndex === ancestors1.length;
  const endContainsStart = firstDistinctAncestorIndex === ancestors2.length;
  let firstPartiallyContainedChild = null;
  if (!startContainsEnd) {
    firstPartiallyContainedChild = ancestors1[firstDistinctAncestorIndex];
  }
  let lastPartiallyContainedChild = null;
  if (!endContainsStart) {
    lastPartiallyContainedChild = ancestors2[firstDistinctAncestorIndex];
  }
  const containedChildren = [];
  const firstChildAfterStart = firstPartiallyContainedChild ? firstPartiallyContainedChild.nextSibling : originalStartNode.childNodes[originalStartOffset];
  const firstChildAfterEnd = lastPartiallyContainedChild || originalEndNode.childNodes[originalEndOffset] || null;
  for (var child = firstChildAfterStart; child && child !== firstChildAfterEnd; child = child.nextSibling) {
    if (isNodeOfType(child, 10 /* DOCUMENT_TYPE_NODE */)) {
      throwHierarchyRequestError(
        isClone ? "Can not clone a doctype using cloneContents" : "Can not extract a doctype using extractContents"
      );
    }
    containedChildren.push(child);
  }
  let newNode;
  let newOffset;
  if (startContainsEnd || isClone) {
    newNode = originalStartNode;
    newOffset = originalStartOffset;
  } else {
    const referenceNode = ancestors1[firstDistinctAncestorIndex];
    newNode = referenceNode.parentNode;
    newOffset = 1 + getNodeIndex(referenceNode);
  }
  if (firstPartiallyContainedChild !== null && isCharacterDataNode(firstPartiallyContainedChild)) {
    const clone = firstPartiallyContainedChild.cloneNode();
    clone.data = firstPartiallyContainedChild.substringData(
      originalStartOffset,
      firstPartiallyContainedChild.length - originalStartOffset
    );
    appendNode(clone, fragment);
    if (!isClone) {
      firstPartiallyContainedChild.replaceData(
        originalStartOffset,
        firstPartiallyContainedChild.length - originalStartOffset,
        ""
      );
    }
  } else if (firstPartiallyContainedChild !== null) {
    const clone = firstPartiallyContainedChild.cloneNode();
    appendNode(clone, fragment);
    const subrange = document3.createRange();
    subrange.setStart(originalStartNode, originalStartOffset);
    subrange.setEnd(
      firstPartiallyContainedChild,
      determineLengthOfNode(firstPartiallyContainedChild)
    );
    const subfragment = extractRange(subrange, isClone);
    subrange.detach();
    appendNode(subfragment, clone);
  }
  containedChildren.forEach((containedChild) => {
    if (isClone) {
      const clone = containedChild.cloneNode(true);
      appendNode(clone, fragment);
    } else {
      appendNode(containedChild, fragment);
    }
  });
  if (lastPartiallyContainedChild && isCharacterDataNode(lastPartiallyContainedChild)) {
    const clone = lastPartiallyContainedChild.cloneNode();
    clone.data = lastPartiallyContainedChild.substringData(0, originalEndOffset);
    appendNode(clone, fragment);
    if (!isClone) {
      lastPartiallyContainedChild.replaceData(0, originalEndOffset, "");
    }
  } else if (lastPartiallyContainedChild !== null) {
    const clone = lastPartiallyContainedChild.cloneNode();
    appendNode(clone, fragment);
    const subrange = document3.createRange();
    subrange.setStart(lastPartiallyContainedChild, 0);
    subrange.setEnd(originalEndNode, originalEndOffset);
    const subfragment = extractRange(subrange, isClone);
    subrange.detach();
    appendNode(subfragment, clone);
  }
  if (!isClone) {
    range2.setStart(newNode, newOffset);
    range2.collapse(true);
  }
  return fragment;
}
var _Range = class _Range {
  get collapsed() {
    return isCollapsed(this);
  }
  /**
   * The Range() constructor, when invoked, must return a new live range with (current global
   * object’s associated Document, 0) as its start and end.
   */
  constructor() {
    const context = getContext(this);
    this.startContainer = context.document;
    this.startOffset = 0;
    this.endContainer = context.document;
    this.endOffset = 0;
    context.addRange(this);
  }
  /**
   * Get the common ancestor of the range's boundary position nodes.
   *
   * Note: for efficiency reasons, this implementation deviates from the algorithm given in 4.2.
   */
  get commonAncestorContainer() {
    const ancestors1 = getInclusiveAncestors(this.startContainer);
    const ancestors2 = getInclusiveAncestors(this.endContainer);
    let commonAncestorContainer = ancestors1[0];
    let i = 0;
    while (i < ancestors1.length && i < ancestors2.length) {
      if (ancestors1[i] !== ancestors2[i]) {
        break;
      }
      commonAncestorContainer = ancestors1[i];
      ++i;
    }
    return commonAncestorContainer;
  }
  /**
   * Sets the start boundary point of the range.
   *
   * @param node   - The new start container
   * @param offset - The new start offset
   */
  setStart(node, offset) {
    expectArity(arguments, 2);
    node = asObject(node, Node);
    offset = asUnsignedLong(offset);
    if (isNodeOfType(node, 10 /* DOCUMENT_TYPE_NODE */)) {
      throwInvalidNodeTypeError("Can not set a range under a doctype node");
    }
    if (offset > determineLengthOfNode(node)) {
      throwIndexSizeError("Can not set a range past the end of the node");
    }
    const rootOfRange = getRootOfRange(this);
    const rootOfNode = getRootOfNode(node);
    if (rootOfRange !== rootOfNode || compareBoundaryPointPositions(node, offset, this.endContainer, this.endOffset) === POSITION_AFTER) {
      this.endContainer = node;
      this.endOffset = offset;
    }
    this.startContainer = node;
    this.startOffset = offset;
  }
  /**
   * Sets the end boundary point of the range.
   *
   * @param node   - The new end container
   * @param offset - The new end offset
   */
  setEnd(node, offset) {
    expectArity(arguments, 2);
    node = asObject(node, Node);
    offset = asUnsignedLong(offset);
    if (isNodeOfType(node, 10 /* DOCUMENT_TYPE_NODE */)) {
      throwInvalidNodeTypeError("Can not set a range under a doctype node");
    }
    if (offset > determineLengthOfNode(node)) {
      throwIndexSizeError("Can not set a range past the end of the node");
    }
    const rootOfRange = getRootOfRange(this);
    const rootOfNode = getRootOfNode(node);
    if (rootOfRange !== rootOfNode || compareBoundaryPointPositions(node, offset, this.startContainer, this.startOffset) === POSITION_BEFORE) {
      this.startContainer = node;
      this.startOffset = offset;
    }
    this.endContainer = node;
    this.endOffset = offset;
  }
  /**
   * Sets the start boundary point of the range to the position just before the given node.
   *
   * @param node - The node to set the range's start before
   */
  setStartBefore(node) {
    expectArity(arguments, 1);
    node = asObject(node, Node);
    const parent = node.parentNode;
    if (parent === null) {
      return throwInvalidNodeTypeError("Can not set range before node without a parent");
    }
    this.setStart(parent, getNodeIndex(node));
  }
  /**
   * Sets the start boundary point of the range to the position just after the given node.
   *
   * @param node - The node to set the range's start before
   */
  setStartAfter(node) {
    expectArity(arguments, 1);
    node = asObject(node, Node);
    const parent = node.parentNode;
    if (parent === null) {
      return throwInvalidNodeTypeError("Can not set range before node without a parent");
    }
    this.setStart(parent, getNodeIndex(node) + 1);
  }
  /**
   * Sets the end boundary point of the range to the position just before the given node.
   *
   * @param node - The node to set the range's end before
   */
  setEndBefore(node) {
    expectArity(arguments, 1);
    node = asObject(node, Node);
    const parent = node.parentNode;
    if (parent === null) {
      return throwInvalidNodeTypeError("Can not set range before node without a parent");
    }
    this.setEnd(parent, getNodeIndex(node));
  }
  /**
   * Sets the end boundary point of the range to the position just after the given node.
   *
   * @param node - The node to set the range's end before
   */
  setEndAfter(node) {
    expectArity(arguments, 1);
    node = asObject(node, Node);
    const parent = node.parentNode;
    if (parent === null) {
      return throwInvalidNodeTypeError("Can not set range before node without a parent");
    }
    this.setEnd(parent, getNodeIndex(node) + 1);
  }
  /**
   * Sets the range's boundary points to the same position.
   *
   * @param toStart - If true, set both points to the start of the range, otherwise set them to
   *                  the end
   */
  collapse(toStart = false) {
    if (toStart) {
      this.endContainer = this.startContainer;
      this.endOffset = this.startOffset;
    } else {
      this.startContainer = this.endContainer;
      this.startOffset = this.endOffset;
    }
  }
  selectNode(node) {
    expectArity(arguments, 1);
    node = asObject(node, Node);
    let parent = node.parentNode;
    if (parent === null) {
      return throwInvalidNodeTypeError("Can not select node with null parent");
    }
    const index = getNodeIndex(node);
    this.startContainer = parent;
    this.startOffset = index;
    this.endContainer = parent;
    this.endOffset = index + 1;
  }
  selectNodeContents(node) {
    expectArity(arguments, 1);
    node = asObject(node, Node);
    if (isNodeOfType(node, 10 /* DOCUMENT_TYPE_NODE */)) {
      throwInvalidNodeTypeError("Can not place range inside a doctype node");
    }
    const length = determineLengthOfNode(node);
    this.startContainer = node;
    this.startOffset = 0;
    this.endContainer = node;
    this.endOffset = length;
  }
  compareBoundaryPoints(how, sourceRange) {
    expectArity(arguments, 2);
    sourceRange = asObject(sourceRange, _Range);
    if (how !== _Range.START_TO_START && how !== _Range.START_TO_END && how !== _Range.END_TO_END && how !== _Range.END_TO_START) {
      throwNotSupportedError("Unsupported comparison type");
    }
    if (getRootOfRange(this) !== getRootOfRange(sourceRange)) {
      throwWrongDocumentError("Can not compare positions of ranges in different trees");
    }
    switch (how) {
      // START_TO_START:
      case _Range.START_TO_START:
        return compareBoundaryPointPositions(
          // this point
          this.startContainer,
          this.startOffset,
          // other point
          sourceRange.startContainer,
          sourceRange.startOffset
        );
      // START_TO_END:
      case _Range.START_TO_END:
        return compareBoundaryPointPositions(
          // this point
          this.endContainer,
          this.endOffset,
          // other point
          sourceRange.startContainer,
          sourceRange.startOffset
        );
      // END_TO_END:
      case _Range.END_TO_END:
        return compareBoundaryPointPositions(
          // this point
          this.endContainer,
          this.endOffset,
          // other point
          sourceRange.endContainer,
          sourceRange.endOffset
        );
      // END_TO_START:
      default:
        return compareBoundaryPointPositions(
          // this point
          this.startContainer,
          this.startOffset,
          // other point,
          sourceRange.endContainer,
          sourceRange.endOffset
        );
    }
  }
  /**
   * Removes the contents of the range
   */
  deleteContents() {
    if (this.collapsed) {
      return;
    }
    const originalStartNode = this.startContainer;
    const originalStartOffset = this.startOffset;
    const originalEndNode = this.endContainer;
    const originalEndOffset = this.endOffset;
    if (originalStartNode === originalEndNode && isCharacterDataNode(originalStartNode)) {
      originalStartNode.replaceData(
        originalStartOffset,
        originalEndOffset - originalStartOffset,
        ""
      );
      return;
    }
    const nodesToRemove = [];
    forEachNodeContainedInRange(this, (node) => {
      nodesToRemove.push(node);
    });
    let newNode;
    let newOffset;
    if (originalStartNode.contains(originalEndNode)) {
      newNode = originalStartNode;
      newOffset = originalStartOffset;
    } else {
      let referenceNode = originalStartNode;
      while (referenceNode.parentNode !== null && !referenceNode.parentNode.contains(originalEndNode)) {
        referenceNode = referenceNode.parentNode;
      }
      newNode = referenceNode.parentNode;
      newOffset = 1 + getNodeIndex(referenceNode);
    }
    if (isCharacterDataNode(originalStartNode)) {
      originalStartNode.replaceData(
        originalStartOffset,
        originalStartNode.length - originalStartOffset,
        ""
      );
    }
    nodesToRemove.forEach((node) => {
      removeNode(node);
    });
    if (isCharacterDataNode(originalEndNode)) {
      originalEndNode.replaceData(0, originalEndOffset, "");
    }
    this.setStart(newNode, newOffset);
    this.collapse(true);
  }
  /**
   * Move the contents of this range into a new DocumentFragment
   *
   * @returns DocumentFragment containing the Range's previous contents
   */
  extractContents() {
    return extractRange(this, false);
  }
  /**
   * Clone the contents of this range into a new DocumentFragment
   *
   * @returns DocumentFragment containing a copy of the Range's contents
   */
  cloneContents() {
    return extractRange(this, true);
  }
  /**
   * Insert node at the start of this range
   *
   * @param node - Node to insert
   */
  insertNode(node) {
    expectArity(arguments, 1);
    node = asObject(node, Node);
    insertNodeIntoRange(node, this);
  }
  /**
   * Wraps the contents of this range in the given new parent
   *
   * This only works if the only partially contained nodes are text nodes. Any existing children
   * of newParent will be removed.
   *
   * @param newParent - Node to insert
   */
  surroundContents(newParent) {
    expectArity(arguments, 1);
    newParent = asObject(newParent, Node);
    const startNonTextNode = isTextNode(this.startContainer) ? this.startContainer.parentNode : this.startContainer;
    const endNonTextNode = isTextNode(this.endContainer) ? this.endContainer.parentNode : this.endContainer;
    if (startNonTextNode !== endNonTextNode) {
      throwInvalidStateError(
        "Can not use surroundContents on a range that has partially selected a non-Text node"
      );
    }
    if (isNodeOfType(
      newParent,
      9 /* DOCUMENT_NODE */,
      10 /* DOCUMENT_TYPE_NODE */,
      11 /* DOCUMENT_FRAGMENT_NODE */
    )) {
      throwInvalidNodeTypeError(
        "Can not use Document, DocumentType, or DocumentFragment as a parent node in surroundContents"
      );
    }
    const fragment = extractRange(this, false);
    if (newParent.firstChild) {
      replaceAllWithNode(null, newParent);
    }
    insertNodeIntoRange(newParent, this);
    appendNode(fragment, newParent);
    this.selectNode(newParent);
  }
  /**
   * Returns a range with the same start and end as this.
   *
   * @returns A copy of this
   */
  cloneRange() {
    const context = getContext(this);
    const range2 = new context.Range();
    range2.startContainer = this.startContainer;
    range2.startOffset = this.startOffset;
    range2.endContainer = this.endContainer;
    range2.endOffset = this.endOffset;
    return range2;
  }
  /**
   * Stops tracking the range.
   *
   * (non-standard) According to the spec, this method must do nothing. However, it is not yet
   * possible in all browsers to allow garbage collection while keeping track of active ranges to
   * be updated by mutations. Therefore, unless your code will only run in environments that
   * implement the WeakRef proposal (https://github.com/tc39/proposal-weakrefs), make sure to call
   * this method to stop updating the range and free up its resources.
   */
  detach() {
    const context = getContext(this);
    context.removeRange(this);
  }
  /**
   * Returns true if the given point is after or equal to the start point and before or equal to
   * the end point of this.
   *
   * @param node   - Node of point to check
   * @param offset - Offset of point to check
   *
   * @returns Whether the point is in the range
   */
  isPointInRange(node, offset) {
    expectArity(arguments, 2);
    node = asObject(node, Node);
    offset = asUnsignedLong(offset);
    if (getRootOfNode(node) !== getRootOfRange(this)) {
      return false;
    }
    if (isNodeOfType(node, 10 /* DOCUMENT_TYPE_NODE */)) {
      throwInvalidNodeTypeError("Point can not be under a doctype");
    }
    if (offset > determineLengthOfNode(node)) {
      throwIndexSizeError("Offset should not be past the end of node");
    }
    if (compareBoundaryPointPositions(node, offset, this.startContainer, this.startOffset) === POSITION_BEFORE || compareBoundaryPointPositions(node, offset, this.endContainer, this.endOffset) === POSITION_AFTER) {
      return false;
    }
    return true;
  }
  /**
   * Compares the given point to the range's boundary points.
   *
   * @param node   - Node of point to check
   * @param offset - Offset of point to check
   *
   * @returns -1, 0 or 1 depending on whether the point is before, inside or after the range,
   *         respectively
   */
  comparePoint(node, offset) {
    expectArity(arguments, 2);
    node = asObject(node, Node);
    offset = asUnsignedLong(offset);
    if (getRootOfNode(node) !== getRootOfRange(this)) {
      throwWrongDocumentError("Can not compare point to range in different trees");
    }
    if (isNodeOfType(node, 10 /* DOCUMENT_TYPE_NODE */)) {
      throwInvalidNodeTypeError("Point can not be under a doctype");
    }
    if (offset > determineLengthOfNode(node)) {
      throwIndexSizeError("Offset should not be past the end of node");
    }
    if (compareBoundaryPointPositions(node, offset, this.startContainer, this.startOffset) === POSITION_BEFORE) {
      return -1;
    }
    if (compareBoundaryPointPositions(node, offset, this.endContainer, this.endOffset) === POSITION_AFTER) {
      return 1;
    }
    return 0;
  }
  /**
   * Returns true if range overlaps the range from before node to after node.
   *
   * @param node - The node to check
   *
   * @returns Whether the range intersects node
   */
  intersectsNode(node) {
    expectArity(arguments, 1);
    node = asObject(node, Node);
    if (getRootOfNode(node) !== getRootOfRange(this)) {
      return false;
    }
    const parent = node.parentNode;
    if (parent === null) {
      return true;
    }
    const offset = getNodeIndex(node);
    return compareBoundaryPointPositions(parent, offset, this.endContainer, this.endOffset) === POSITION_BEFORE && compareBoundaryPointPositions(
      parent,
      offset + 1,
      this.startContainer,
      this.startOffset
    ) === POSITION_AFTER;
  }
  /**
   * The stringification behavior must run these steps:
   */
  toString() {
    let s = [];
    const startContainer = this.startContainer;
    if (isTextNode(startContainer)) {
      if (this.startContainer === this.endContainer) {
        return startContainer.substringData(
          this.startOffset,
          this.endOffset - this.startOffset
        );
      }
      s.push(
        startContainer.substringData(
          this.startOffset,
          startContainer.length - this.startOffset
        )
      );
    }
    forEachNodeContainedInRange(this, (node) => {
      forEachInclusiveDescendant(node, (node2) => {
        if (isTextNode(node2)) {
          s.push(node2.data);
        }
      });
    });
    const endContainer = this.endContainer;
    if (isTextNode(endContainer)) {
      s.push(endContainer.substringData(0, this.endOffset));
    }
    return s.join("");
  }
};
_Range.START_TO_START = 0;
_Range.START_TO_END = 1;
_Range.END_TO_END = 2;
_Range.END_TO_START = 3;
var Range = _Range;
var POSITION_BEFORE = -1;
var POSITION_EQUAL = 0;
var POSITION_AFTER = 1;
function compareBoundaryPointPositions(nodeA, offsetA, nodeB, offsetB) {
  if (nodeA !== nodeB) {
    const ancestors1 = getInclusiveAncestors(nodeA);
    const ancestors2 = getInclusiveAncestors(nodeB);
    while (ancestors1[0] && ancestors2[0] && ancestors1[0] === ancestors2[0]) {
      ancestors1.shift();
      ancestors2.shift();
    }
    if (ancestors1.length) {
      offsetA = getNodeIndex(ancestors1[0]) + 0.5;
    }
    if (ancestors2.length) {
      offsetB = getNodeIndex(ancestors2[0]) + 0.5;
    }
  }
  if (offsetA === offsetB) {
    return POSITION_EQUAL;
  }
  return offsetA < offsetB ? POSITION_BEFORE : POSITION_AFTER;
}
function getRootOfRange(range2) {
  return getRootOfNode(range2.startContainer);
}

// slimdom.js/src/XMLDocument.ts
var XMLDocument = class extends Document {
  /**
   * (non-standard) Creates a copy of this, not including its children.
   *
   * @param document - The node document to associate with the copy
   *
   * @returns A shallow copy of this
   */
  _copy(document3) {
    const context = getContext(document3);
    return new context.XMLDocument();
  }
};

// slimdom.js/src/dom-parsing/DOMParser.ts
var DOMParser = class {
  /**
   * Constructs a new DOMParser object.
   */
  constructor() {
  }
  /**
   * Parse str using a parser that matches type's supported MIME types (either XML or HTML), and
   * return a Document object containing the parsed content if successful. If not successful,
   * returns a Document describing the error.
   *
   * @param str  - The string to parse
   * @param type - The mime type to parse the string as
   *
   * @returns  Either the document resulting from successfully parsing str, or a document
   *           describing the error.
   */
  parseFromString(str, type) {
    switch (type) {
      case "text/html":
        throw new Error("HTML parsing is not implemented");
      case "text/xml":
      case "application/xml":
      case "application/xhtml+xml":
      case "image/svg+xml":
        try {
          const doc = parseXmlDocument(str);
          return doc;
        } catch (error2) {
          const document3 = new Document();
          const root = document3.createElementNS(
            "http://www.mozilla.org/newlayout/xml/parsererror.xml",
            "parsererror"
          );
          root.appendChild(document3.createTextNode(`${error2}`));
          document3.appendChild(root);
          return document3;
        }
      default:
        throw new TypeError(
          `The type "${type}" is not a valid value in the SupportedType enumeration.`
        );
    }
  }
};

// slimdom.js/src/dom-parsing/XMLSerializer.ts
var XMLSerializer = class {
  /**
   * Constructs a new XMLSerializer object.
   */
  constructor() {
  }
  /**
   * Serializes root into a string using an XML serialization. Throws a TypeError exception if
   * root is not a Node.
   *
   * @param root - The node to serialize
   *
   * @returns The XML resulting from serialization
   */
  serializeToString(root) {
    root = asObject(root, Node);
    const result = [];
    produceXmlSerialization(root, false, result);
    return result.join("");
  }
};
function serializeToWellFormedString(root) {
  root = asObject(root, Node);
  const result = [];
  produceXmlSerialization(root, true, result);
  return result.join("");
}

// slimdom.js/src/mutation-observer/MutationObserver.ts
var MutationObserver = class {
  /**
   * Constructs a MutationObserver object and sets its callback to callback. The callback is
   * invoked with a list of MutationRecord objects as first argument and the constructed
   * MutationObserver object as second argument. It is invoked after nodes registered with the
   * observe() method, are mutated.
   *
   * @param callback - Function called after mutations have been observed.
   */
  constructor(callback) {
    /**
     * The list of nodes on which this observer is a RegisteredObserver's observer.
     */
    this._nodes = [];
    /**
     * The list of MutationRecord objects collected so far.
     */
    this._recordQueue = [];
    /**
     * Tracks transient registered observers created for this observer, to simplify their removal.
     */
    this._transients = [];
    expectArity(arguments, 1);
    callback = asObject(callback, Function);
    this._callback = callback;
  }
  /**
   * Instructs the user agent to observe a given target (a node) and report any mutations based on
   * the criteria given by options (an object).
   *
   * NOTE: Adding an observer to an element is just like addEventListener, if you observe the
   * element multiple times it does not make a difference. Meaning if you observe element twice,
   * the observe callback does not fire twice, nor will you have to run disconnect() twice. In
   * other words, once an element is observed, observing it again with the same will do nothing.
   * However if the callback object is different it will of course add another observer to it.
   *
   * @param target  - Node (or root of subtree) to observe
   * @param options - Determines which types of mutations to observe
   */
  observe(target, options) {
    expectArity(arguments, 2);
    target = asObject(target, Node);
    options.childList = !!options.childList;
    options.subtree = !!options.subtree;
    if (options.attributeOldValue !== void 0 && options.attributes === void 0) {
      options.attributes = true;
    }
    if (options.characterDataOldValue !== void 0 && options.characterData === void 0) {
      options.characterData = true;
    }
    if (!(options.childList || options.attributes || options.characterData)) {
      throw new TypeError(
        'The options object must set at least one of "attributes", "characterData", or "childList" to true.'
      );
    }
    if (options.attributeOldValue && !options.attributes) {
      throw new TypeError(
        'The options object may only set "attributeOldValue" to true when "attributes" is true or not present.'
      );
    }
    if (options.characterDataOldValue && !options.characterData) {
      throw new TypeError(
        'The options object may only set "characterDataOldValue" to true when "characterData" is true or not present.'
      );
    }
    target._registeredObservers.register(this, options);
  }
  /**
   * Stops the MutationObserver instance from receiving notifications of DOM mutations. Until the
   * observe() method is used again, observer's callback will not be invoked.
   */
  disconnect() {
    this._nodes.forEach((node) => node._registeredObservers.removeForObserver(this));
    this._nodes.length = 0;
    this._recordQueue.length = 0;
  }
  /**
   * Empties the MutationObserver instance's record queue and returns what was in there.
   *
   * @returns An Array of MutationRecord objects that were recorded.
   */
  takeRecords() {
    const records = this._recordQueue.concat();
    this._recordQueue.length = 0;
    return records;
  }
};

// slimdom.js/src/index.ts
var document2 = new Document();
defaultContext.document = document2;
defaultContext.Attr = Attr;
defaultContext.CDATASection = CDATASection;
defaultContext.Comment = Comment;
defaultContext.Document = Document;
defaultContext.DocumentFragment = DocumentFragment;
defaultContext.DocumentType = DocumentType;
defaultContext.DOMImplementation = DOMImplementation;
defaultContext.Element = Element2;
defaultContext.ProcessingInstruction = ProcessingInstruction;
defaultContext.Range = Range;
defaultContext.Text = Text;
defaultContext.XMLDocument = XMLDocument;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Attr,
  CDATASection,
  CharacterData,
  Comment,
  DOMException,
  DOMImplementation,
  DOMParser,
  Document,
  DocumentFragment,
  DocumentType,
  Element,
  MutationObserver,
  MutationRecord,
  Node,
  ProcessingInstruction,
  Range,
  StaticRange,
  Text,
  XMLDocument,
  XMLSerializer,
  document,
  parseXmlDocument,
  parseXmlFragment,
  serializeToWellFormedString,
  unsafeAppendAttribute,
  unsafeCreateAttribute,
  unsafeCreateElement
});
