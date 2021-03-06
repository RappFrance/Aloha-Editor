/* dom2.js is part of Aloha Editor project http://aloha-editor.org
 *
 * Aloha Editor is a WYSIWYG HTML5 inline editing library and editor. 
 * Copyright (c) 2010-2012 Gentics Software GmbH, Vienna, Austria.
 * Contributors http://aloha-editor.org/contribution.php 
 * 
 * Aloha Editor is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License
 * as published by the Free Software Foundation; either version 2
 * of the License, or any later version.
 *
 * Aloha Editor is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301, USA.
 * 
 * As an additional permission to the GNU GPL version 2, you may distribute
 * non-source (e.g., minimized or compacted) forms of the Aloha-Editor
 * source code without the copy of the GNU GPL normally required,
 * provided you include this license notice and a URL through which
 * recipients can access the Corresponding Source.
 */
define([
	'jquery',
	'util/functions',
	'util/maps',
	'util/arrays',
	'util/strings',
	'util/browser'
], function (
	$,
	Fn,
	Maps,
	Arrays,
	Strings,
	Browser
) {
	'use strict';

	var spacesRx = /\s+/;
	var attrRegex = /\s([^\/<>\s=]+)(?:=(?:"[^"]*"|'[^']*'|[^>\/\s]+))?/g;

	/**
	 * Like insertBefore, inserts firstChild into parent before
	 * refChild, except also inserts all the following siblings of
	 * firstChild.
	 */
	function moveNextAll(parent, firstChild, refChild) {
		while (firstChild) {
			var nextChild = firstChild.nextSibling;
			parent.insertBefore(firstChild, refChild);
			firstChild = nextChild;
		}
	}

	/**
	 * Used to serialize outerHTML of DOM elements in older (pre-HTML5) Gecko,
	 * Safari, and Opera browsers.
	 *
	 * Beware that XMLSerializer generates an XHTML string (<div class="team" />
	 * instead of <div class="team"></div>).  It is noted here:
	 * http://stackoverflow.com/questions/1700870/how-do-i-do-outerhtml-in-firefox
	 * that some browsers (like older versions of Firefox) have problems with
	 * XMLSerializer, and an alternative, albeit more expensive option, is
	 * described.
	 *
	 * @type {XMLSerializer|null}
	 */
	var Serializer = window.XMLSerializer && new window.XMLSerializer();

	/**
	 * Gets the serialized HTML that describes the given DOM element and its
	 * innerHTML.
	 *
	 * Polyfill for older versions of Gecko, Safari, and Opera browsers.
	 * @see https://bugzilla.mozilla.org/show_bug.cgi?id=92264 for background.
	 *
	 * @param {HTMLElement} node DOM Element.
	 * @return {String}
	 */
	function outerHtml(node) {
		var html = node.outerHTML;
		if (typeof html !== 'undefined') {
			return html;
		}
		try {
			return Serializer ? Serializer.serializeToString(node) : node.xml;
		} catch (e) {
			return node.xml;
		}
	}

	/**
	 * Retrieves the names of all attributes from the given elmenet.
	 *
	 * Correctly handles the case that IE7 and IE8 have approx 70-90
	 * default attributes on each and every element.
	 *
	 * This implementation does not iterate over the elem.attributes
	 * property since that is much slower on IE7 (even when
	 * checking the attrNode.specified property). Instead it parses the
	 * HTML of the element. For elements with few attributes the
	 * performance on IE7 is improved by an order of magnitued.
	 *
	 * On IE7, when you clone a <button disabled="disabled"/> or an
	 * <input checked="checked"/> element the boolean properties will
	 * not be set on the cloned node. We choose the speed optimization
	 * over correctness in this case. The dom-to-xhtml plugin has a
	 * workaround for this case.
	 */
	function attrNames(elem) {
		var names = [];
		var html = outerHtml(elem.cloneNode(false));
		var match;
		while (null != (match = attrRegex.exec(html))) {
			names.push(match[1]);
		}
		return names;
	}

	/**
	 * Gets the attributes of the given element.
	 *
	 * See attrNames() for an edge case on IE7.
	 *
	 * @param elem
	 *        An element to get the attributes for.
	 * @return
	 *        An array containing [name, value] tuples for each attribute.
	 *        Attribute values will always be strings, but possibly empty strings.
	 */
	function attrs(elem) {
		var as = [];
		var names = attrNames(elem);
		var i;
		var len;
		for (i = 0, len = names.length; i < len; i++) {
			var name = names[i];
			var value = $.attr(elem, name);
			if (null == value) {
				value = "";
			} else {
				value = value.toString();
			}
			as.push([name, value]);
		}
		return as;
	}

	/**
	 * Like indexByClass() but operates on a list of elements instead.
	 * The given list may be a NodeList, HTMLCollection, or an array.
	 */
	function indexByClassHaveList(elems, classMap) {
		var index = {},
		    indexed,
		    classes,
		    elem,
		    cls,
		    len,
		    i,
		    j;
		for (i = 0, len = elems.length; i < len; i++) {
			elem = elems[i];
			if (elem.className) {
				classes = Strings.words(elem.className);
				for (j = 0; j < classes.length; j++) {
					cls = classes[j];
					if (classMap[cls]) {
						indexed = index[cls];
						if (indexed) {
							indexed.push(elem);
						} else {
							index[cls] = [elem];
						}
					}
				}
			}
		}
		return index;
	}

	/**
	 * Indexes descendant elements based on the individual classes in
	 * the class attribute.
	 *
	 * Based on these observations;
	 * 
	 * * $('.class1, .class2') takes twice as long as $('.class1') on IE7.
	 *
	 * * $('.class1, .class2') is fast on IE8 (approx the same as
	 *   $('.class'), no matter how many classes), but if the individual
	 *   elements in the result set should be handled differently, the
	 *   subsequent hasClass('.class1') and hasClass('.class2') calls
	 *   slow things down again.
	 *
	 * * DOM traversal with elem.firstChild elem.nextSibling is very
	 *   slow on IE7 compared to just iterating over
	 *   root.getElementsByTagName('*').
	 *
	 * * $('name.class') is much faster than just $('.class'), but as
	 *   soon as you need a single class in classMap that may be present
	 *   on any element, that optimization doesn't gain anything since
	 *   then you have to examine every element.
	 *
	 * This function will always take approx. the same amount of time
	 * (on IE7 approx. equivalent to a single call to $('.class')) no
	 * matter how many entries there are in classMap to index.
	 *
	 * This function only makes sense for multiple entries in
	 * classMap. For a single class lookup, $('.class') or
	 * $('name.class') is fine (even better in the latter case).
	 *
	 * @param root
	 *        The root element to search for elements to index
	 *        (will not be included in search).
	 * @param classMap
	 *        A map from class name to boolean true.
	 * @return
	 *        A map from class name to an array of elements with that class.
	 *        Every entry in classMap for which elements have been found
	 *        will have a corresponding entry in the returned
	 *        map. Entries for which no elements have been found, may or
	 *        may not have an entry in the returned map.
	 */
	function indexByClass(root, classMap) {
		var elems;
		if (Browser.ie7) {
			elems = root.getElementsByTagName('*');
		} else {
			// Optimize for browsers that support querySelectorAll/getElementsByClassName.
			// On IE8 for example, if there is a relatively high
			// elems/resultSet ratio, performance can improve by a factor of 2.
			elems = $(root).find('.' + Maps.keys(classMap).join(',.'));
		}
		return indexByClassHaveList(elems, classMap);
	}

	/**
	 * Indexes descendant elements based on elem.nodeName.
	 *
	 * Based on these observations:
	 *
	 * * On IE8, for moderate values of names.length, individual calls to
	 *   getElementsByTagName is just as fast as $root.find('name, name,
	 *   name, name').
	 *
	 * * On IE7, $root.find('name, name, name, name') is extemely slow
	 *   (can be an order of magnitude slower than individual calls to
	 *    getElementsByTagName, why is that?).
	 *
	 * * Although getElementsByTagName is very fast even on IE7, when
	 *   names.length > 7 an alternative implementation that iterates
	 *   over all tags and checks names from a hashmap (similar to how
	 *   indexByClass does it) may become interesting, but
	 *   names.length > 7 is unlikely.
	 *
	 * This function only makes sense if the given names array has many
	 * entries. For only one or two different names, calling $('name')
	 * or context.getElementsByTagName(name) directly is fine (but
	 * beware of $('name, name, ...') as explained above).
	 *
	 * The signature of this function differs from indexByClass by not
	 * taking a map but instead an array of names.
	 *
	 * @param root
	 *        The root element to search for elements to index
	 *        (will not be included in search).
	 * @param names
	 *        An array of element names to look for.
	 *        Names must be in all-uppercase (the same as elem.nodeName).
	 * @return
	 *        A map from element name to an array of elements with that name.
	 *        Names will be all-uppercase.
	 *        Arrays will be proper arrays, not NodeLists.
	 *        Every entry in classMap for which elements have been found
	 *        will have a corresponding entry in the returned
	 *        map. Entries for which no elements have been found, may or
	 *        may not have an entry in the returned map.
	 */
	function indexByName(root, names) {
		var i,
		    index = {},
		    len;
		for (i = 0, len = names.length; i < len; i++) {
			var name = names[i];
			index[name] = $.makeArray(root.getElementsByTagName(name));
		}
		return index;
	}


	function nodeIndex(node) {
		var ret = 0;
		while (node.previousSibling) {
			ret++;
			node = node.previousSibling;
		}
		return ret;
	}

	/**
	 * http://www.quirksmode.org/dom/w3c_core.html
	 * "IE up to 8 does not count empty text nodes."
	 */
	function numChildren(elem) {
		var count = 0;
		var child = elem.firstChild;
		while (child) {
			count += 1;
			child = child.nextSibling;
		}
		return count;
	}

	function nodeLength(node) {
		if (1 === node.nodeType) {
			return numChildren(node);
		}
		if (3 === node.nodeType) {
			return node.length;
		}
		return 0;
	}

	function isAtEnd(node, offset) {
		return (1 === node.nodeType
				&& offset >= numChildren(node))
			|| (3 === node.nodeType
				&& offset === node.length
				&& !node.nextSibling);
	}

	/**
	 * @param node if a text node, should have a parent node.
	 */
	function nodeAtOffset(node, offset) {
		if (1 === node.nodeType && offset < numChildren(node)) {
			node = node.childNodes[offset];
		} else if (3 === node.nodeType && offset === node.length) {
			node = node.nextSibling || node.parentNode;
		}
		return node;
	}

	function Cursor(node, atEnd) {
		this.node = node;
		this.atEnd = atEnd;
	}

	/**
	 * A cursor has the added utility over other iteration methods of
	 * iterating over the end position of an element. The start and end
	 * positions of an element are immediately before the element and
	 * immediately after the last child respectively. All node positions
	 * except end positions can be identified just by a node. To
	 * distinguish between element start and end positions, the
	 * additional atEnd boolean is necessary.
	 */
	function cursor(node, atEnd) {
		return new Cursor(node, atEnd);
	}

	Cursor.prototype.next = function () {
		var node = this.node;
		var next;
		if (this.atEnd || 1 !== node.nodeType) {
			next = node.nextSibling;
			if (next) {
				this.atEnd = false;
			} else {
				next = node.parentNode;
				if (!next) {
					return false;
				}
				this.atEnd = true;
			}
			this.node = next;
		} else {
			next = node.firstChild;
			if (next) {
				this.node = next;
			} else {
				this.atEnd = true;
			}
		}
		return true;
	};

	Cursor.prototype.prev = function () {
		var node = this.node;
		var prev;
		if (this.atEnd) {
			prev = node.lastChild;
			if (prev) {
				this.node = prev;
			} else {
				this.atEnd = false;
			}
		} else {
			prev = node.previousSibling;
			if (prev) {
				if (1 === node.nodeType) {
					this.atEnd = true;
				}
			} else {
				prev = node.parentNode;
				if (!prev) {
					return false;
				}
			}
			this.node = prev;
		}
		return true;
	};

	Cursor.prototype.equals = function (cursor) {
		return cursor.node === this.node && cursor.atEnd === this.atEnd;
	};

	Cursor.prototype.clone = function (cursor) {
		return cursor(cursor.node, cursor.atEnd);
	};

	Cursor.prototype.setRangeStart = function (range) {
		if (this.atEnd) {
			range.setStart(this.node, numChildren(this.node));
		} else {
			range.setStart(this.node.parentNode, nodeIndex(this.node));
		}
	};

	Cursor.prototype.setRangeEnd = function (range) {
		if (this.atEnd) {
			range.setEnd(this.node, numChildren(this.node));
		} else {
			range.setEnd(this.node.parentNode, nodeIndex(this.node));
		}
	};

	function insert(node, ref, atEnd) {
		if (atEnd) {
			ref.appendChild(node);
		} else {
			ref.parentNode.insertBefore(node, ref);
		}
	}

	Cursor.prototype.insert = function (node) {
		return insert(node, this.node, this.atEnd);
	};

	/**
	 * @param offset if node is a text node, the offset will be ignored.
	 * @param node if a text node, should have a parent node.
	 */
	function cursorFromBoundaryPoint(node, offset) {
		return cursor(nodeAtOffset(node, offset), isAtEnd(node, offset));
	}

	function parentsUntil(node, pred) {
		var parents = [];
		var parent = node.parentNode;
		while (parent && !pred(parent)) {
			parents.push(parent);
			parent = parent.parentNode;
		}
		return parents;
	}

	function parentsUntilIncl(node, pred) {
		var parents = parentsUntil(node, pred);
		var topmost = parents.length ? parents[parents.length - 1] : node;
		if (topmost.parentNode) {
			parents.push(topmost.parentNode);
		}
		return parents;
	}

	function childAndParentsUntil(node, pred) {
		if (pred(node)) {
			return [];
		}
		var parents = parentsUntil(node, pred);
		parents.unshift(node);
		return parents;
	}

	function childAndParentsUntilIncl(node, pred) {
		if (pred(node)) {
			return [node];
		}
		var parents = parentsUntilIncl(node, pred);
		parents.unshift(node);
		return parents;
	}

	function childAndParentsUntilNode(node, untilNode) {
		return childAndParentsUntil(node, function (nextNode) {
			return nextNode === untilNode;
		});
	}

	function childAndParentsUntilInclNode(node, untilInclNode) {
		return childAndParentsUntilIncl(node, function (nextNode) {
			return nextNode === untilInclNode;
		});
	}

	function splitTextNode(node, offset) {
		// Because node.splitText() is buggy on IE, split it manually.
		// http://www.quirksmode.org/dom/w3c_core.html
		var parent = node.parentNode;
		var text = node.nodeValue;
		if (0 === offset || offset >= text.length) {
			return node;
		}
		var before = document.createTextNode(text.substring(0, offset));
		var after = document.createTextNode(text.substring(offset, text.length));
		parent.insertBefore(before, node);
		parent.insertBefore(after, node);
		parent.removeChild(node);
		return before;
	}

	function adjustRangeAfterSplit(range, container, offset, setProp, splitNode, newNodeBeforeSplit) {
		if (container !== splitNode) {
			return;
		}
		var newNodeLength = newNodeBeforeSplit.length;
		if (offset === 0) {
			container = newNodeBeforeSplit.parentNode;
			offset = nodeIndex(newNodeBeforeSplit);
		} else if (offset < newNodeLength) {
			container = newNodeBeforeSplit;
		} else if (offset === newNodeLength) {
			container = newNodeBeforeSplit.parentNode;
			offset = nodeIndex(newNodeBeforeSplit) + 1;
		} else {// offset > newNodeLength
			var newNodeAfterSplit = newNodeBeforeSplit.nextSibling;
			container = newNodeAfterSplit;
			offset -= newNodeLength;
		}
		range[setProp].call(range, container, offset);
	}

	function splitNodeAdjustRange(splitNode, splitOffset, sc, so, ec, eo, range) {
		if (3 !== splitNode.nodeType) {
			return;
		}
		var newNodeBeforeSplit = splitTextNode(splitNode, splitOffset);
		adjustRangeAfterSplit(range, sc, so, 'setStart', splitNode, newNodeBeforeSplit);
		adjustRangeAfterSplit(range, ec, eo, 'setEnd', splitNode, newNodeBeforeSplit);
	}

	function splitTextContainers(range) {
		var sc = range.startContainer;
		var so = range.startOffset;
		var ec = range.endContainer;
		var eo = range.endOffset;
		splitNodeAdjustRange(sc, so, sc, so, ec, eo, range);
		// Because the range may have been adjusted.
		sc = range.startContainer;
		so = range.startOffset;
		ec = range.endContainer;
		eo = range.endOffset;
		splitNodeAdjustRange(ec, eo, sc, so, ec, eo, range);
	}

	function adjustRangeShallowRemove(container, offset, node) {
		if (container === node) {
			return [node.parentNode, nodeIndex(node) + offset];
		}
		if (container === node.parentNode && offset > nodeIndex(node)) {
			// Because the node to be removed is already already
			// included in offset, -1.
			return [container, offset - 1 + numChildren(node)];
		}
		return null;
	}

	/**
	 * If the container node equals the node, the boundary point will
	 * continue to point at node which will be inside the wrapper after
	 * mutation (no adjustment).
	 *
	 * If the container node equals the node's parent, the boundary
	 * point will continue to point at the node's parent after mutation
	 * (no adjustment).
	 */
	function adjustRangeWrap(container, offset, node, wrapper) {
		// No adjustments necessary.
		return null;
	}

	function adjustRangeInsert(container, offset, node, ref, atEnd, moveRangeWithNode, left) {
		if (atEnd) {
			if (container === ref && offset === numChildren(ref)) {
				if (node.parentNode !== container) {
					offset += 1;
				}
				return [container, offset];
			}
		} else {
			if (container === ref.parentNode && offset > nodeIndex(ref)) {
				// Because if the node is at or after offset, it
				// will be moved backwards across offset, increasing
				// it.
				if (node.parentNode !== container || nodeIndex(node) >= offset) {
					offset += 1;
				}
				return [container, offset];
			}
		}
		if (container === node.parentNode) {
			var index = nodeIndex(node);
			if (left && moveRangeWithNode && (offset === index || offset === index + 1)) {
				if (atEnd) {
					return [ref, numChildren(ref) + (offset - index)];
				} else {
					return [ref.parentNode, nodeIndex(ref) + (offset - index)];
				}
			}
			if (offset > index) {
				return [container, offset - 1];
			}
		}
		return null;
	}

	function adjustRange(range, adjust, mutate, arg1, arg2, arg3, arg4) {
		var adjustStart, adjustEnd;
		if (range) {
			var sc = range.startContainer;
			var so = range.startOffset;
			var ec = range.endContainer;
			var eo = range.endOffset;
			// Because mutation of the DOM may modify the range, we must
			// always reset it, even if no adjustment may be necessary
			// of the values pre-mutation, therefore || [sc, so].
			adjustStart = adjust(sc, so, arg1, arg2, arg3, arg4, true) || [sc, so];
			adjustEnd = adjust(ec, eo, arg1, arg2, arg3, arg4, false) || [ec, eo];
		}
		mutate(arg1, arg2, arg3, arg4);
		if (range) {
			range.setStart.apply(range, adjustStart);
			range.setEnd.apply(range, adjustEnd);
		}
	}

	function shallowRemove(node) {
		var parent = node.parentNode;
		moveNextAll(parent, node.firstChild, node);
		parent.removeChild(node);
	}

	function wrap(node, wrapper) {
		node.parentNode.replaceChild(wrapper, node);
		wrapper.appendChild(node);
	}

	function shallowRemovePreserve(node, range) {
		adjustRange(range, adjustRangeShallowRemove, shallowRemove, node);
	}

	function wrapPreserve(node, wrapper, range) {
		if (wrapper.parentNode) {
			shallowRemovePreserve(wrapper, range);
		}
		// Because the wrapped node is replaced by wrapper, the removal
		// of it will not affect adjustment calculation (after mutation
		// there is a node in its place, so offsets remain correct).
		adjustRange(range, adjustRangeWrap, wrap, node, wrapper);
	}

	function insertPreserve(node, ref, atEnd, range, moveRangeWithNode) {
		adjustRange(range, adjustRangeInsert, insert, node, ref, atEnd, moveRangeWithNode);
	}

	function walkUntil(node, fn, until, arg) {
		while (node && !until(node, arg)) {
			node = fn(node, arg);
		}
		return node;
	}

	function walk(node, fn, arg) {
		walkUntil(node, fn, Fn.returnFalse, arg);
	}

	function walkRec(node, fn, arg) {
		if (1 === node.nodeType) {
			walk(node.firstChild, function (node) {
				return walkRec(node, fn, arg);
			});
		}
		return fn(node, arg);
	}

	function walkUntilNode(node, fn, untilNode, arg) {
		return walkUntil(node, fn, function (nextNode) {
			return nextNode === untilNode;
		}, arg);
	}

	function nextSibling(node) {
		return node.nextSibling;
	}

	// TODO when restacking the <b> that wraps "z" in
	// <u><b>x</b><s><b>z</b></s></u>, join with the <b> that wraps "x".
	function restackRec(node, hasContext, notIgnoreHorizontal, notIgnoreVertical) {
		if (1 !== node.nodeType || notIgnoreVertical(node)) {
			return null;
		}
		var maybeContext = walkUntil(node.firstChild, nextSibling, notIgnoreHorizontal);
		if (!maybeContext) {
			return null;
		}
		var notIgnorable = walkUntil(maybeContext.nextSibling, nextSibling, notIgnoreHorizontal);
		if (notIgnorable) {
			return null;
		}
		if (hasContext(maybeContext)) {
			return maybeContext;
		}
		return restackRec(maybeContext, hasContext, notIgnoreHorizontal, notIgnoreVertical);
	}

	function restack(node, hasContext, ignoreHorizontal, ignoreVertical, range) {
		var notIgnoreHorizontal = function (node) {
			return hasContext(node) || !ignoreHorizontal(node);
		};
		var notIgnoreVertical = Fn.complement(ignoreVertical);
		if (hasContext(node)) {
			return true;
		}
		var context = restackRec(node, hasContext, notIgnoreHorizontal, notIgnoreVertical);
		if (!context) {
			return false;
		}
		wrapPreserve(node, context, range);
		return true;
	}

	function StableRange(range) {
		this.startContainer = range.startContainer;
		this.startOffset = range.startOffset;
		this.endContainer = range.endContainer;
		this.endOffset = range.endOffset;
		this.commonAncestorContainer = range.commonAncestorContainer;
		this.collapsed = range.collapsed;
		this.stable = true;
	}

	StableRange.prototype.update = function () {
		if (!this.startContainer || !this.endContainer) {
			return;
		}
		this.collapsed = (this.startContainer === this.endContainer
						  && this.startOffset === this.endOffset);
		var start = childAndParentsUntil(this.startContainer, Fn.returnFalse);
		var end   = childAndParentsUntil(this.endContainer, Fn.returnFalse);
		this.commonAncestorContainer = Arrays.intersect(start, end)[0];
	};

	StableRange.prototype.setStart = function (sc, so) {
		this.startContainer = sc;
		this.startOffset = so;
		this.update();
	};

	StableRange.prototype.setEnd = function (ec, eo) {
		this.endContainer = ec;
		this.endOffset = eo;
		this.update();
	};

	function setRangeFromRange(range, ref) {
		range.setStart(ref.startContainer, ref.startOffset);
		range.setEnd(ref.endContainer, ref.endOffset);
	}

	/**
	 * A native range is live, which means that modifying the DOM may
	 * mutate the range. Also, using setStart/setEnd may not set the
	 * properties correctly (the browser may perform its own
	 * normalization of boundary points). The behaviour of a native
	 * range is very erratic and should be converted to a stable range
	 * as the first thing in any algorithm.
	 */
	function stableRange(range) {
		return range.stable ? range : new StableRange(range);
	}

	/**
	 * Boundary points of the given range should not be inside text
	 * nodes (splitTextContainers()) because the dom cursor passed to
	 * ignoreLeft and ignoreRight does not traverse positions inside
	 * text nodes.
	 *
	 * The exact rules for when text node containers are passed are as
	 * follows: If the left boundary point is inside a text node,
	 * trimming will start before it. If the right boundary point is
	 * inside a text node, trimming will start after it.
	 */
	function trimRange(range, ignoreLeft, ignoreRight) {
		if (range.collapsed) {
			return;
		}
		var start = cursorFromBoundaryPoint(range.startContainer, range.startOffset);
		var end = cursorFromBoundaryPoint(range.endContainer, range.endOffset);
		var setStart = false;
		while (!start.equals(end) && ignoreLeft(start) && start.next()) {
			setStart = true;
		}
		ignoreRight = ignoreRight || ignoreLeft;
		var setEnd = false;
		if (3 === range.endContainer.nodeType
			    && range.endOffset > 0
			    // Because the cursor already normalizes
			    // endOffset == endContainer.length to the node next after it.
			    && range.endOffset < range.endContainer.length
			    && end.next()) {
			if (ignoreRight(end)) {
				end.prev();
			}
		}
		while (!end.equals(start) && ignoreRight(end) && end.prev()) {
			setEnd = true;
		}
		if (setStart) {
			start.setRangeStart(range);
		}
		if (setEnd) {
			end.setRangeEnd(range);
		}
	}

	function trimRangeClosingOpening(range, ignoreLeft, ignoreRight) {
		ignoreRight = ignoreRight || ignoreLeft;
		trimRange(range, function (cursor) {
			return cursor.atEnd || ignoreLeft(cursor.node);
		}, function (cursor) {
			var prev = cursor.atEnd ? cursor.node.lastChild : cursor.node.previousSibling;
			return !prev || ignoreRight(prev);
		});
	}

	return {
		moveNextAll: moveNextAll,
		attrNames: attrNames,
		attrs: attrs,
		indexByClass: indexByClass,
		indexByName: indexByName,
		indexByClassHaveList: indexByClassHaveList,
		outerHtml: outerHtml,
		cursor: cursor,
		cursorFromBoundaryPoint: cursorFromBoundaryPoint,
		nodeAtOffset: nodeAtOffset,
		isAtEnd: isAtEnd,
		parentsUntil: parentsUntil,
		parentsUntilIncl: parentsUntilIncl,
		childAndParentsUntil: childAndParentsUntil,
		childAndParentsUntilIncl: childAndParentsUntilIncl,
		childAndParentsUntilNode: childAndParentsUntilNode,
		childAndParentsUntilInclNode: childAndParentsUntilInclNode,
		nodeIndex: nodeIndex,
		splitTextNode: splitTextNode,
		splitTextContainers: splitTextContainers,
		shallowRemovePreserve: shallowRemovePreserve,
		wrapPreserve: wrapPreserve,
		insertPreserve: insertPreserve,
		walk: walk,
		walkRec: walkRec,
		walkUntil: walkUntil,
		walkUntilNode: walkUntilNode,
		restack: restack,
		stableRange: stableRange,
		trimRange: trimRange,
		trimRangeClosingOpening: trimRangeClosingOpening,
		setRangeFromRange: setRangeFromRange
	};
});
