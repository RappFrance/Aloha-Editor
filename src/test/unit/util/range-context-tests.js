Aloha.require([
	'aloha/core',
	'jquery',
	'util/dom2',
	'util/trees',
	'util/arrays',
	'util/strings',
	'util/html',
	'util/range-context',
	'dom-to-xhtml/dom-to-xhtml'
], function (
	Aloha,
	$,
	Dom,
	Trees,
	Arrays,
	Strings,
	Html,
	RangeContext,
	DomToXhtml
) {
	'use strict';

	module('RangeContext');

	function insertBoundaryMarkers(range) {
		var leftMarkerChar  = (3 === range.startContainer.nodeType ? '[' : '{');
		var rightMarkerChar = (3 === range.endContainer.nodeType   ? ']' : '}');
		Dom.splitTextContainers(range);
		var leftMarker = document.createTextNode(leftMarkerChar);
		var rightMarker = document.createTextNode(rightMarkerChar);
		var start = Dom.cursorFromBoundaryPoint(range.startContainer, range.startOffset);
		var end = Dom.cursorFromBoundaryPoint(range.endContainer, range.endOffset);
		start.insert(leftMarker);
		end.insert(rightMarker);
	}

	function extractBoundaryMarkers(rootElem, range) {
		var markers = ['[', '{', '}', ']'];
		var markersFound = 0;
		function setBoundaryPoint(marker, node) {
			var setFn;
			if (0 === markersFound) {
				setFn = 'setStart';
				if (marker !== '[' && marker !== '{') {
					throw "end marker before start marker";
				}
			} else if (1 === markersFound) {
				setFn = 'setEnd';
				if (marker !== ']' && marker !== '}') {
					throw "start marker before end marker";
				}
			} else {
				throw "Too many markers";
			}
			markersFound += 1;
			if (marker === '[' || marker === ']') {
				var previousSibling = node.previousSibling;
				if (!previousSibling || 3 !== previousSibling.nodeType) {
					previousSibling = document.createTextNode('');
					node.parentNode.insertBefore(previousSibling, node);
				}
				range[setFn].call(range, previousSibling, previousSibling.length);
				// Because we have set a text offset.
				return false;
			} else { // marker === '{' || marker === '}'
				range[setFn].call(range, node.parentNode, Dom.nodeIndex(node));
				// Because we have set a non-text offset.
				return true;
			}
		}
		function extractMarkers(node) {
			if (3 !== node.nodeType) {
				return node.nextSibling;
			}
			var text = node.nodeValue;
			var parts = Strings.splitIncl(text, /[\[\{\}\]]/g);
			// Because modifying every text node when there can be
			// only two markers seems like too much overhead.
			if (!Arrays.contains(markers, parts[0]) && parts.length < 2) {
				return node.nextSibling;
			}
			// Because non-text boundary positions must not be joined again.
			var forceNextSplit = false;
			Arrays.forEach(parts, function (part, i) {
				// Because we don't want to join text nodes we haven't split.
				forceNextSplit = forceNextSplit || (i === 0);
				if (Arrays.contains(markers, part)) {
					forceNextSplit = setBoundaryPoint(part, node);
				} else if (!forceNextSplit && node.previousSibling && 3 === node.previousSibling.nodeType) {
					node.previousSibling.insertData(node.previousSibling.length, part);
				} else {
					node.parentNode.insertBefore(document.createTextNode(part), node);
				}
			});
			var next = node.nextSibling;
			node.parentNode.removeChild(node);
			return next;
		}
		Dom.walkRec(rootElem, extractMarkers);
		if (2 !== markersFound) {
			throw "Missing one or both markers";
		}
	}

	function switchElemTextSelection(html) {
		return html.replace(/[\{\}\[\]]/g, function (match) {
			return {'{': '[',
					'}': ']',
					'[': '{',
					']': '}'}[match];
		});
	}

	var testCount = 0;

	function testMutation(title, before, expected, mutate) {
		test(title + '-' + testCount++, function () {
			var dom = $(before)[0];
			var range = Aloha.createRange();
			extractBoundaryMarkers(dom, range);
			dom = mutate(dom, range) || dom;
			insertBoundaryMarkers(range);
			var actual = DomToXhtml.nodeToXhtml(dom);
			if ($.type(expected) === 'function') {
				expected(actual);
			} else {
				equal(actual, expected);
			}
		});
	}

	function testMutationSwitchElemTextSelection(title, before, after, mutate) {
		testMutation(title, before, after, mutate);
		var afterSwitched = switchElemTextSelection(after);
		testMutation(title, switchElemTextSelection(before), function (actual) {
			if (actual !== afterSwitched
				    // Because it's ok it's ok as long as they come out
				    // at the same position, we ignore differences between
				    // selection type (text or element boundaries).
				    && actual !== after
				    // Because we must account for end of text node
				    // normalization performed by Dom.nodeAtOffset() and
				    // Dom.isAtEnd().
				    && actual !== afterSwitched.replace(/\]/g, '}')
				    ) {
				if (actual !== afterSwitched) {
					equal(actual, afterSwitched);
				} else if (actual !== afterSwitched.replace(/\]/g, '}')) {
					equal(actual, afterSwitched.replace(/\]/g, '}'));
				} else if (actual !== after) {
					equal(actual, after);
				}
			}
		}, mutate);
	}

	function testFormat(title, before, after) {
		testMutation(title, before, after, function (dom, range) {
			RangeContext.format(range, 'B', false);
		});
	}

	function testUnformat(title, before, after) {
		testMutation(title, before, after, function (dom, range) {
			RangeContext.format(range, 'B', true);
		});
	}

	function testInsertExtractBoundaryMarkers(title, htmlWithBoundaryMarkers) {
		test(title + testCount++, function () {
			var dom = $(htmlWithBoundaryMarkers)[0];
			var range = Aloha.createRange();
			extractBoundaryMarkers(dom, range);
			equal(DomToXhtml.nodeToXhtml(dom), htmlWithBoundaryMarkers.replace(/[\[\{\}\]]/g, ''));
			insertBoundaryMarkers(range);
			equal(DomToXhtml.nodeToXhtml(dom), htmlWithBoundaryMarkers);
		});
	};

	function testInsertExtractBoundaryMarkers2(title, htmlWithBoundaryMarkers) {
		testInsertExtractBoundaryMarkers(title, htmlWithBoundaryMarkers);
		testInsertExtractBoundaryMarkers(title, switchElemTextSelection(htmlWithBoundaryMarkers));
	}

	function testTrimRange(title, before, after, switched) {
		testMutationSwitchElemTextSelection(title, before, after, function (dom, range) {
			Dom.trimRangeClosingOpening(range, Html.isIgnorableWhitespace);
		});
	}

	var t = function (htmlWithBoundaryMarkers) {
		testInsertExtractBoundaryMarkers('extractBoundaryMarkers,insertBoundaryMarkers-', htmlWithBoundaryMarkers);
	};
	t('<p>{Some text.}</p>');
	t('<p>Some{ }text.</p>');
	t('<p>{}Some text.</p>');
	t('<p>Some text.{}</p>');
	t('<p>Som{}e text.</p>');
	t('<p>{<b>Some text.</b>}</p>');
	t('<p>12{34<b>Some text.</b>56}78</p>');
	t('<p>{1234<b>Some text.</b>5678}</p>');
	t('<p>1234{<b>Some text.</b>}5678</p>');

	var t = function (before, after) {
		testTrimRange('Dom.trimRange', before, after);
	};
	t('<p>So[me te]xt.</p>', '<p>So[me te]xt.</p>');
	t('<p>So[]xt.</p>', '<p>So[]xt.</p>');
	t('<p>{Some text.}</p>', '<p>{Some text.}</p>');
	t('<p>{}Some text.</p>', '<p>{}Some text.</p>');
	t('<p>Some text.{}</p>', '<p>Some text.{}</p>');
	t('<p>{}</p>', '<p>{}</p>');
	t('<p><b>So[me</b><i> </i><b>te]xt.</b></p>',
	  '<p><b>So[me</b><i> </i><b>te]xt.</b></p>');		
	t('<p><b>Some</b>{<i> </i>}<b>text.</b></p>',
	  '<p><b>Some</b>{<i> </i>}<b>text.</b></p>');		
	t('<p><b>[Some</b><i> </i><b>text.]</b></p>',
	  '<p><b>[Some</b><i> </i><b>text.]</b></p>');		
	t('<p><b>{</b><i>}</i></p>', '<p><b></b>{}<i></i></p>');
	t('<p><b><i>{</i></b><i><b>}</b></i></p>',
	  '<p><b><i></i></b>{}<i><b></b></i></p>');
	t('<p><b><i>one{</i></b><i>two</i><b><i>}three</i></b></p>',
	  '<p><b><i>one</i></b>{<i>two</i>}<b><i>three</i></b></p>');
	t('<p><b><i>one{</i>.</b><i>two</i><b>.<i>}three</i></b></p>',
	  '<p><b><i>one</i>{.</b><i>two</i><b>.}<i>three</i></b></p>');
	t('<p><b><i>{one</i></b><i>two</i><b><i>three}</i></b></p>',
	  '<p><b><i>{one</i></b><i>two</i><b><i>three}</i></b></p>');

	var t = function (before, after) {
		testFormat('RangeContext.format', before, after);
	};
	// Tests noop.
	t('<p><b>[Some text.]</b></p>', '<p><b>{Some text.}</b></p>');
	t('<p>{<b>Some text.</b>}</p>', '<p>{<b>Some text.</b>}</p>');
	t('<p><b><i>[Some text.]</i></b></p>', '<p><b><i>{Some text.}</i></b></p>');

	// Tests joining existing context element.s
	t('<p>{<b>Some</b><b> text.</b>}</p>', '<p>{<b>Some text.</b>}</p>');

	// Tests bolding a node with text boundary points.
	t('<p>[Some text.]</p>', '<p>{<b>Some text.</b>}</p>');
	// Tests bolding a node, splitting text.
	t('<p>So[me te]xt.</p>', '<p>So{<b>me te</b>}xt.</p>');
	// Tests bolding a node with element boundary points.
	t('<p>{<i>Some text.</i>}</p>', '<p>{<b><i>Some text.</i></b>}</p>');

	// Tests descending two levels down to each boundary point, with
	// boundary points at start and end of container respectively.
	t('<p><i>one<em>{Some</em>left</i>text<i>right<em>.}</em>two</i></p>',
	  '<p><i>one<b><em>{Some</em>left</b></i><b>text</b><i><b>right</b><em><b>.</b>}</em>two</i></p>');
	// Tests same as above except with boundary points in the the middle
	// of container.
	t('<p><i>one<em>!{Some</em>left</i>text<i>right<em>.}!</em>two</i></p>',
	  '<p><i>one<em>!{<b>Some</b></em><b>left</b></i><b>text</b><i><b>right</b><em><b>.</b>}!</em>two</i></p>');
	// Tests same as above except with boundary points at end/start of
	// container respectively.
	//(without range trimming)
	//t('<p><i>one<em>!{</em>left</i>text<i>right<em>}!</em>two</i></p>',
	//  '<p><i>one<em>!{</em><b>left</b></i><b>text</b><i><b>right</b><em>}!</em>two</i></p>');
	//(with range trimming)
	t('<p><i>one<em>!{</em>left</i>text<i>right<em>}!</em>two</i></p>',
	  '<p><i>one<em>!</em>{<b>left</b></i><b>text</b><i><b>right</b>}<em>!</em>two</i></p>');
	// Tests same as above except with boundary points in empty container.
	//(without range trimming)
	//t('<p><i>one<em>{</em>left</i>text<i>right<em>}</em>two</i></p>',
	//  '<p><i>one<em>{</em><b>left</b></i><b>text</b><i><b>right</b><em>}</em>two</i></p>');
	//(with range trimming)
	t('<p><i>one<em>{</em>left</i>text<i>right<em>}</em>two</i></p>',
	  '<p><i>one<em></em>{<b>left</b></i><b>text</b><i><b>right</b>}<em></em>two</i></p>');

	var t = function (before, after) {
		testFormat('RangeContext.format-restack', before, after);
	};
	// Tests restacking of existing bold element.
	t('<p><i><u><s><b>Some</b></s></u>{ text}</i></p>',
	  '<p><i><b><u><s>Some</s></u>{ text</b>}</i></p>');
	// Tests no restacking when some non-ignorable content is encountered.
	t('<p><i><u><s>!<b>Some</b></s></u>{ text}</i></p>',
	  '<p><i><u><s>!<b>Some</b></s></u>{<b> text</b>}</i></p>');
	// Tests same as above but with non-ignorable content after bold tag.
	t('<p><i><u><s><b>Some</b>!</s></u>{ text}</i></p>',
	  '<p><i><u><s><b>Some</b>!</s></u>{<b> text</b>}</i></p>');
	// Tests same as above but ith non-ignorable content between between child/parent at end.
	t('<p><i><u><s><b>Some</b></s>!</u>{ text}</i></p>',
	  '<p><i><u><s><b>Some</b></s>!</u>{<b> text</b>}</i></p>');
	// Tests same as above but ith non-ignorable content between between child/parent at start.
	t('<p><i><u>!<s><b>Some</b></s></u>{ text}</i></p>',
	  '<p><i><u>!<s><b>Some</b></s></u>{<b> text</b>}</i></p>');
	// Tests same as above but ith non-ignorable content as previous sibling to bolded text.
	t('<p><i><u><s><b>Some</b></s></u>!{ text}</i></p>',
	  '<p><i><u><s><b>Some</b></s></u>!{<b> text</b>}</i></p>');


	var t = function (before, after) {
		testUnformat('RangeContext.unformat', before, after);
	};
	// Tests noop.
	t('<p>{Some text.}</p>', '<p>{Some text.}</p>');
	// Tests unbolding parent with text boundary points.
	t('<p><b>[Some text.]</b></p>', '<p>{Some text.}</p>');
	// Tests unbolding parent with element boundary points.
	t('<p><b>{<i>Some text.</i>}</b></p>', '<p>{<i>Some text.</i>}</p>');
	// Tests unbolding ancestor.
	t('<p><b><i>{Some text.}</i></b></p>', '<p><i>{Some text.}</i></p>');

	// Tests unbolding end tag of i.
	t('<p><b><i>one{</i>two}</b></p>',
	  '<p><b><i>one</i></b>{two}</p>');
	// Tests same as above, but unbolds start tag of i.
	t('<p><b>{one<i>}two</i></b></p>',
	  '<p>{one}<b><i>two</i></b></p>');
	// Tests same as above, but with an additional sibling before the i.
	t('<p><b>one<i>two{</i>three}</b></p>',
	  '<p><b>one<i>two</i>{</b>three}</p>');
	// Tests same as above, but with an additional sibling after the i.
	t('<p><b>{one<i>}two</i>three</b></p>',
	  '<p>{one}<b><i>two</i>three</b></p>');

	// Tests pushing down through the commonAncestorContainer.
	t('<p><b>one<i>{Some text.}</i>two</b></p>', '<p><b>one</b><i>{Some text.}</i><b>two</b></p>');
	// Tests pushing down two levels through the commonAncestorContainer.
	t('<p><b>one<em>two<i>{Some text.}</i>three</em>four</b></p>',
	  '<p><b>one</b><em><b>two</b><i>{Some text.}</i><b>three</b></em><b>four</b></p>');

	// Tests pushing down two levels through the commonAncestorContainer
	// and two levels down to each boundary point, with boundary points
	// at start and end of container respectively.
	t('<p><b>1<em>2<i>3<sub>4<u>{Some</u>Z</sub>text<sub>Z<u>.}</u>5</sub>6</i>7</em>8</b></p>',
	  '<p><b>1</b><em><b>2</b><i><b>3</b><sub><b>4</b><u>{Some</u>Z</sub>text<sub>Z<u>.}</u><b>5</b></sub><b>6</b></i><b>7</b></em><b>8</b></p>');
	// Tests same as above except with boundary points in the the middle
	// of container.
	t('<p><b>1<em>2<i>3<sub>4<u>left{Some</u>Z</sub>text<sub>Z<u>.}right</u>5</sub>6</i>7</em>8</b></p>',
	  '<p><b>1</b><em><b>2</b><i><b>3</b><sub><b>4</b><u><b>left</b>{Some</u>Z</sub>text<sub>Z<u>.}<b>right</b></u><b>5</b></sub><b>6</b></i><b>7</b></em><b>8</b></p>');
	// Tests same as above except with boundary points at end/start of
	// container respectively.
	//(without range trimming)
	//t('<p><b>1<em>2<i>3<sub>4<u>Some{</u>Z</sub>text<sub>Z<u>}.</u>5</sub>6</i>7</em>8</b></p>',
	//  '<p><b>1</b><em><b>2</b><i><b>3</b><sub><b>4</b><u><b>Some</b>{</u>Z</sub>text<sub>Z<u>}<b>.</b></u><b>5</b></sub><b>6</b></i><b>7</b></em><b>8</b></p>');
	//(with range trimming)
	t('<p><b>1<em>2<i>3<sub>4<u>Some{</u>Z</sub>text<sub>Z<u>}.</u>5</sub>6</i>7</em>8</b></p>',
	  '<p><b>1</b><em><b>2</b><i><b>3</b><sub><b>4<u>Some</u>{</b>Z</sub>text<sub>Z}<b><u>.</u>5</b></sub><b>6</b></i><b>7</b></em><b>8</b></p>');
	// Tests same as above except with boundary points in empty container.
	//(wtithout range trimming)
	//t('<p><b>1<em>2<i>3<sub>4<u>{</u>Z</sub>text<sub>Z<u>}</u>5</sub>6</i>7</em>8</b></p>',
	//  '<p><b>1</b><em><b>2</b><i><b>3</b><sub><b>4</b><u>{</u>Z</sub>text<sub>Z<u>}</u><b>5</b></sub><b>6</b></i><b>7</b></em><b>8</b></p>');
	//(with range trimming)
	t('<p><b>1<em>2<i>3<sub>4<u>{</u>Z</sub>text<sub>Z<u>}</u>5</sub>6</i>7</em>8</b></p>',
	  '<p><b>1</b><em><b>2</b><i><b>3</b><sub><b>4<u></u>{</b>Z</sub>text<sub>Z}<b><u></u>5</b></sub><b>6</b></i><b>7</b></em><b>8</b></p>');
});
