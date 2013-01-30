/* -*- Mode: js; js-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */

'use strict';


/**
 * Web Typist
 * a free, web-based, simple touch-typing tutor
 */


/******************************************************************************
 * Browser Abstraction Layer: DOM events, localStorage, XMLHttpRequest
 */

var EVENTS = (function(window, document, undefined) {
  var bind = function(node, type, callback) {};
  var unbind = function(node, type, callback) {};
  var trigger = function(node, type) {};
  var preventDefault = function(event) {};
  var domReady = function(callback) {};

  // addEventListener should work fine everywhere except with IE<9
  if (window.addEventListener) { // modern browsers
    var eventList = {};
    bind = function(node, type, callback) {
      if (!node) return;
      node.addEventListener(type, callback, false);
    };
    unbind = function(node, type, callback) {
      if (!node) return;
      node.removeEventListener(type, callback, false);
    };
    trigger = function(node, type) {
      if (!node) return;
      var evtObject = eventList[type];
      if (!evtObject) {
        evtObject = document.createEvent('Event');
        evtObject.initEvent(type, false, false);
        eventList[type] = evtObject;
      }
      node.dispatchEvent(evtObject);
    };
    preventDefault = function(event) {
      event.preventDefault();
    };
    domReady = function(callback) {
      window.addEventListener('DOMContentLoaded', callback, false);
    };
  }
  else if (window.attachEvent) { // Internet Explorer 6/7/8
    /**
     * This also fixes the 'this' reference issue in all callbacks
     * -- both for standard and custom events.
     * http://www.quirksmode.org/blog/archives/2005/10/_and_the_winner_1.html
     */
    bind = function(node, type, callback) {
      if (!node) return;
      var ref = type + callback;
      type = 'on' + type;
      if (type in node) { // standard DOM event
        if (!node['e' + ref]) {
          node['e' + ref] = callback;
          node[ref] = function() {
            node['e' + ref](window.event);
          };
          node.attachEvent(type, node[ref]);
        }
      }
      else { // custom event
        if (!node.eventList) {
          node.eventList = {};
        }
        if (!node.eventList[type]) {
          node.eventList[type] = [];
        }
        node.eventList[type].push(callback);
      }
    };
    unbind = function(node, type, callback) {
      if (!node) return;
      var ref = type + callback;
      type = 'on' + type;
      if (type in node) { // standard DOM event
        if (node['e' + ref]) {
          node.detachEvent(type, node[ref]);
          try {
            delete(node[ref]);
            delete(node['e' + ref]);
          } catch (e) { // IE6 doesn't support 'delete()' above
            node[ref] = null;
            node['e' + ref] = null;
          }
        }
      }
      else { // custom event
        if (!node || !node.eventList || !node.eventList[type])
          return;
        var callbacks = node.eventList[type];
        var cbLength = callbacks.length;
        for (var i = 0; i < cbLength; i++) {
          if (callbacks[i] == callback) {
            callbacks.slice(i, 1);
            return;
          }
        }
      }
    };
    trigger = function(node, type) {
      if (!node) return;
      type = 'on' + type;
      if (type in node) try { // standard DOM event?
        node.fireEvent(type);
        return;
      } catch (e) {}
      // custom event: pass an event-like structure to the callback
      // + use call() to set the 'this' reference within the callback
      var evtObject = {};
      evtObject.target = node;
      evtObject.srcElement = node;
      if (!node || !node.eventList || !node.eventList[type])
        return;
      var callbacks = node.eventList[type];
      var cbLength = callbacks.length;
      for (var i = 0; i < cbLength; i++)
        callbacks[i].call(node, evtObject);
    };
    preventDefault = function(event) {
      event.returnValue = false;
    };
    domReady = function(callback) {
      window.attachEvent('load', callback);
    };
  }

  // API
  return {
    bind: bind,
    unbind: unbind,
    trigger: trigger,
    preventDefault: preventDefault,
    onDOMReady: domReady
  };
})(this, document);

var STORAGE = (function(window, document, undefined) {
  if ('localStorage' in window)
    return localStorage;

  return { // use cookies as a fallback
    getItem: function getCookie(name) {
      var results = document.cookie.match('(^|;) ?' + name + '=([^;]*)(;|$)');
      return results ? (unescape(results[2])) : '';
    },
    setItem: function setCookie(name, value, expiredays) {
      document.cookie = name + '=' + escape(value);
    },
    removeItem: function removeCookie(name) {
      document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:01 GMT';
    }
  };
})(this, document);

function xhrLoadXML(href, callback) {
  /**
   * - IE6 doesn't support XMLHttpRequest natively
   * - IE6/7/8 don't support overrideMimeType with native XMLHttpRequest
   * - IE6/7/8/9 don't allow loading any local file with native XMLHttpRequest
   * => so we use ActiveX for XHR on IE, period.
   */
  if (window.ActiveXObject) {
    var xhr = new ActiveXObject('Microsoft.XMLHTTP');
    xhr.open('GET', href, true);
    xhr.onreadystatechange = function() {
      if (xhr.readyState == 4) {
        var xmldoc = new ActiveXObject('Microsoft.XMLDOM');
        xmldoc.loadXML(xhr.responseText);
        callback(xmldoc);
      }
    };
    xhr.send(null);
  }
  // note that Chrome won't allow loading any local document with XHR
  else if (window.XMLHttpRequest) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', href, true);
    xhr.onreadystatechange = function() {
      if (xhr.readyState == 4) {
        callback(xhr.responseXML);
      }
    };
    xhr.send(null);
  }
}


/******************************************************************************
 * Keyboard Display
 */

var gKeyboard = (function(window, document, undefined) {
  var layoutId = '';
  var layoutDoc = null;     // xml layout document
  var keymap = new Array(); // [ (charString, keyRef) ]
  var keymod = new Array(); // [ (charString, modifierRef) ]
  var usrInputTimeout = 150;
  var usrInputStyle = 'color: white; background-color: black;';
  var ui = {
    layout: null,
    variant: null,
    keyboard: null,
    shape: null,
    hints: null,
    hands: null,
    activeKey: null,
    activeMod: null
  };

  function init() {
    keymap = new Array();

    ui.layout = document.getElementById('layout');
    ui.variant = document.getElementById('variant');
    ui.keyboard = document.getElementById('keyboard');
    ui.shape = document.getElementById('shape');
    ui.hints = document.getElementById('hints');
    ui.hands = document.getElementById('hands');

    ui.layout.onchange = function() { setLayout(this.value); };
    ui.variant.onchange = function() { setVariant(this.value); };
    ui.shape.onchange = function() { setShape(this.value); };
    // IE6 doesn't support 'onchange' on checkboxes, using 'onclick' instead
    ui.hints.onclick = function() { showHints(this.checked); };

    var kbLayout = window.location.hash.substring(1) ||
      STORAGE.getItem('kbLayout') || 'qwerty';
    setLayout(kbLayout);
    setShape(STORAGE.getItem('kbShape') || 'pc104');
    showHints(STORAGE.getItem('kbHints') != 'off');
  }

  function setShape(value) {
    if (value == 'pc105') {
      document.getElementById('key_AE01').className = 'left5';
      document.getElementById('key_AE02').className = 'left5';
      document.getElementById('key_AE03').className = 'left4';
      document.getElementById('key_AE04').className = 'left3';
      document.getElementById('key_AE05').className = 'left2';
      document.getElementById('key_AE06').className = 'left2';
      document.getElementById('key_AE07').className = 'right2';
      document.getElementById('key_AE08').className = 'right2';
      document.getElementById('key_AE09').className = 'right3';
      document.getElementById('key_AE10').className = 'right4';
    } else {
      document.getElementById('key_AE01').className = 'left5';
      document.getElementById('key_AE02').className = 'left4';
      document.getElementById('key_AE03').className = 'left3';
      document.getElementById('key_AE04').className = 'left2';
      document.getElementById('key_AE05').className = 'left2';
      document.getElementById('key_AE06').className = 'right2';
      document.getElementById('key_AE07').className = 'right2';
      document.getElementById('key_AE08').className = 'right3';
      document.getElementById('key_AE09').className = 'right4';
      document.getElementById('key_AE10').className = 'right5';
    }
    STORAGE.setItem('kbShape', value);
    ui.keyboard.className = value;
    ui.shape.value = value;
  }

  function showHints(on) {
    document.body.className = on ? 'hints' : '';
    ui.hints.checked = on;
    STORAGE.setItem('kbHints', (on ? 'on' : 'off'));
  }

  function setLayout(kbLayout) {
    ui.variant.innerHTML = '<option> (loading...) </option>';

    // [layout]-[variant]
    var tmp = kbLayout.split('-');
    var name = tmp[0];
    var variantID = (tmp.length > 1) ? tmp[1] : '';

    // load the layout file
    var href = 'layouts/' + name + '.xml';
    xhrLoadXML(href, function(xmldoc) {
      layoutDoc = xmldoc;
      var variants = xmldoc.getElementsByTagName('variant');

      // sort variants alphabetically
      var options = [];
      for (var i = 0; i < variants.length; i++) {
        options.push({
          id: variants[i].getAttribute('id'),
          name: variants[i].getAttribute('name')
        });
      }
      options.sort(function(a, b) {
        return a.name.localeCompare ?
               a.name.localeCompare(b.name) : (a.name > b.name);
      });

      // update the layout selector
      layoutId = name;
      ui.layout.value = name;

      // fill the variant selector
      ui.variant.innerHTML = '';
      for (i = 0; i < options.length; i++) {
        var option = document.createElement('option');
        var value = document.createTextNode(options[i].name);
        option.appendChild(value);
        option.setAttribute('value', options[i].id);
        ui.variant.appendChild(option);
      }

      // select the variant (and update the cookie)
      setVariant(variantID || variants[0].getAttribute('id'));
    });
  }

  function setVariant(variantID) {
    // var variant = layoutDoc.getElementById(variantID);
    // getElementById doesn't work on these XML files and I can't see why *sigh*
    // So this here's a dirty getElementById:
    var variant = null;
    var tmp = layoutDoc.getElementsByTagName('variant');
    for (var i = 0; i < tmp.length; i++) {
      if (tmp[i].getAttribute('id') == variantID) {
        variant = tmp[i];
        break;
      }
    }
    if (!variant)
      return;

    // load the base layout the selected variant relies on, if any
    var include = variant.getAttribute('include');
    if (include) {
      setVariant(include);
    }

    // fill the graphical keyboard
    var keys = variant.getElementsByTagName('key');
    for (var i = 0; i < keys.length; i++) {
      drawKey(keys[i]);
    }

    // update the variant selector
    ui.variant.value = variantID;

    // update hash + cookie
    var kbLayout = layoutId.split('-')[0] + '-' + variantID;
    window.location.hash = kbLayout;
    STORAGE.setItem('kbLayout', kbLayout);
    EVENTS.trigger(window, 'layoutchange');
    layoutId = kbLayout;
  }

  function drawKey(xmlElement) {
    var name = xmlElement.getAttribute('name');
    var base = xmlElement.getAttribute('base');
    var shift = xmlElement.getAttribute('shift');
    var element = document.getElementById('key_' + name);
    if (!element)
      return;

    // fill <li> element
    element.innerHTML = '';
    // create <strong> for 'shift'
    var strong = document.createElement('strong');
    var strongStr = document.createTextNode(shift);
    strong.appendChild(strongStr);
    element.appendChild(strong);
    // append <em> for 'base' if necessary (not a letter)
    if (shift.toLowerCase() != base) {
      var em = document.createElement('em');
      var emStr = document.createTextNode(base);
      em.appendChild(emStr);
      element.appendChild(em);
    }

    // store current key in the main hash table
    keymap[base] = element;
    keymap[shift] = element;
    if (base != shift) {
      var id = 'key_' + (/^left/.test(element.className) ? 'RTSH' : 'LFSH');
      keymod[shift] = document.getElementById(id);
    }
  }

  function pressKey(keyChar) {
    // highlight the key that has been pressed
    var key = keymap[keyChar];
    if (key) {
      key.style.cssText = usrInputStyle;
      setTimeout(function() {
        key.style.cssText = '';
      }, usrInputTimeout);
    }
  }

  function highlightKey(keyChar) {
    // remove last key's highlighting
    if (ui.activeKey) {
      var className = ui.activeKey.className.replace(/\s.*$/, '');
      ui.activeKey.className = className;
    }
    if (ui.activeMod) {
      ui.activeMod.className = 'specialKey';
    }

    // highlight the new key and the corresponding finger
    var key = keymap[keyChar];
    if (key) {
      ui.hands.className = key.className;
      ui.activeKey = key;
      key.className += ' active';
    }

    // highlight the modifier, if any
    var mod = keymod[keyChar];
    if (mod) {
      ui.hands.className += ' shift';
      ui.activeMod = mod;
      mod.className += ' active';
    }
  }

  return {
    init: init,
    getLayout: function() { return layoutId; },
    setLayout: setLayout,
    highlightKey: highlightKey,
    pressKey: pressKey
  };
})(this, document);


/******************************************************************************
 * Typing Lessons (aka KTouchLecture)
 */

var gLessons = (function(window, document, undefined) {
  var lessonsDoc = null;
  var currentLevel = -1;
  var ui = {
    lesson: null,
    level: null,
    output: null
  };

  function init() {
    ui.lesson = document.getElementById('lesson');
    ui.level = document.getElementById('level');

    ui.lesson.onchange = function() { setLesson(this.value); };
    ui.level.onchange = function() { setLevel(this.value); };

    setLesson(STORAGE.getItem('lessonName') || 'english',
              STORAGE.getItem('lessonLevel'));
  }

  function setLesson(name, levelIndex) {
    // clear the level selector
    ui.level.innerHTML = '<option> (loading...) </option>';

    // load the layout file
    var href = 'lessons/' + name + '.ktouch.xml';
    xhrLoadXML(href, function(xmldoc) {
      lessonsDoc = xmldoc;
      var levelNodes = xmldoc.getElementsByTagName('Level');

      // fill the lesson selector
      ui.level.innerHTML = '';
      for (var i = 0; i < levelNodes.length; i++) {
        var name = levelNodes[i].getElementsByTagName('NewCharacters')
                                .item(0).childNodes[0].nodeValue;
        var option = document.createElement('option');
        var text = document.createTextNode((i + 1) + ': ' + name);
        option.appendChild(text);
        option.setAttribute('value', i);
        ui.level.appendChild(option);
      }

      // select the difficulty level
      setLevel(levelIndex);
    });

    // update the form selector
    STORAGE.setItem('lessonName', name);
    ui.lesson.value = name;
  }

  function setLevel(levelIndex) {
    levelIndex = levelIndex || 0;
    ui.level.value = levelIndex;
    STORAGE.setItem('lessonLevel', levelIndex);
    EVENTS.trigger(window, 'lessonchange');
  }

  function newPrompt() {
    var index = ui.level.selectedIndex;
    if (index < 0)
      return;

    // select a random line in the current level
    var lines = lessonsDoc.getElementsByTagName('Level').item(index)
                          .getElementsByTagName('Line');
    var i = Math.floor(Math.random() * lines.length);
    return lines[i].childNodes[0].nodeValue;
  }

  return {
    init: init,
    setLesson: setLesson,
    newPrompt: newPrompt
  };
})(this, document);


/******************************************************************************
 * Metrics
 */

var gTimer = (function(window, document, undefined) {
  var typos = 0;
  var startDate = null;
  var testString = '';
  var ui = {
    accuracy: null,
    speed: null
  };

  function init() {
    ui.accuracy = document.getElementById('accuracy');
    ui.speed = document.getElementById('speed');
  }

  function start(text) {
    startDate = new Date();
    testString = text;
    typos = 0;
  }

  function stop() {
    var elapsed = (new Date() - startDate) / 1000;
    if (elapsed < 1)
      return;
    ui.speed.innerHTML = Math.round(testString.length * 60 / elapsed);
    ui.accuracy.innerHTML = typos;
  }

  function typo() {
    typos++;
  }

  return {
    init: init,
    start: start,
    stop: stop,
    typo: typo
  };
})(this, document);


/******************************************************************************
 * Main
 */

var gTypist = (function(window, document, undefined) {
  var usrInputTimeout = 150;
  var text = '';
  var ui = {
    txtPrompt: null,
    txtInput: null
  };

  function init() {
    ui.txtPrompt = document.getElementById('txtPrompt');
    ui.txtInput = document.getElementById('txtInput');

    ui.txtPrompt.value = '';
    ui.txtInput.value = '';
    ui.txtInput.focus();

    EVENTS.bind(window, 'lessonchange', newPrompt);
    EVENTS.bind(window, 'layoutchange', newPrompt);

    /**
     * Bind event listeners to the text input:
     *  'keypress' : tracks normal keys (characters)
     *  'keydown'  : tracks special keys (tab, escape, backspace...)
     *  'keyup'    : tracks inputs in the <textarea> node:
     *     the 'input' event would work much better (less latency)
     *     but it isn't supported by IE<9 and Safari 4
     */

    EVENTS.bind(ui.txtInput, 'keypress', onKeyPress);
    EVENTS.bind(ui.txtInput, 'keydown', onKeyDown);
    EVENTS.bind(ui.txtInput, 'keyup', function() {
      onInput(this.value);
    });
  }

  // display a new exercise and start the test
  function newPrompt() {
    text = gLessons.newPrompt();
    gTimer.stop();
    gTimer.start(text);

    ui.txtPrompt.value = text;
    ui.txtInput.value = '';
    ui.txtInput.focus();

    gKeyboard.highlightKey(text.substring(0, 1));
  }

  // find which key has been pressed
  function onKeyPress(event) {
    var keyChar = '';
    if (event.which == null) {
      keyChar = String.fromCharCode(event.keyCode); // IE
    } else if (event.which != 0 && event.charCode != 0) {
      keyChar = String.fromCharCode(event.which);   // modern browsers
    } else if (event.keyCode >= 32 && event.keyCode < 127) {
      keyChar = String.fromCharCode(event.keyCode);
    }
    gKeyboard.pressKey(keyChar);
  }

  // disable special keys in the text input box
  function onKeyDown(event) {
    switch (event.keyCode) {
      case 8:  // BackSpace
      case 9:  // Tab
      case 46: // Delete
      case 27: // Escape
        EVENTS.preventDefault(event);
        return;
    }
  }

  function onInput(value) {
    if (!value.length) { // empty input box => reset timer
      gTimer.start(text);
      gKeyboard.highlightKey(text.substr(0, 1));
      return;
    }

    var pos = value.length - 1;
    if (pos == 0) { // first char => start the timer
      gTimer.start(text);
    }

    // Check if the last char is correct
    var entered = value.substring(pos);
    var expected = text.substr(pos, 1);
    if (entered != expected) { // mistake
      gTimer.typo();
    }

    // Check if the whole input is correct
    var correct = (value == text.substr(0, pos + 1));
    if (correct) {
      // highlight the next key (or remove highlighting if it's finished)
      gKeyboard.highlightKey(text.substr(pos + 1, 1));
      if (pos >= text.length - 1) { // finished
        newPrompt();
      }
    } else {
      // auto-correction
      ui.txtInput.className = 'error';
      setTimeout(function() {
        ui.txtInput.className = '';
      }, usrInputTimeout);
      ui.txtInput.value = ui.txtInput.value.substr(0, pos);
    }
  }

  return {
    init: init,
    newPrompt: newPrompt
  };
})(this, document);


/******************************************************************************
 * Startup
 */

EVENTS.onDOMReady(function() {
  gLessons.init();
  gKeyboard.init();
  gTimer.init();
  gTypist.init();
});

EVENTS.bind(window, 'hashchange', function() { // won't work with IE<8
  var kbLayout = window.location.hash.substr(1);
  if (kbLayout != gKeyboard.getLayout()) {
    gKeyboard.setLayout(kbLayout);
  }
});


/******************************************************************************
 * Ad-Blocker test
 */

if (window.addEventListener) window.addEventListener('load', function() {
  // Check that all keys are properly displayed --
  // AdBlockPlus is likely to hide a few keys *sigh*
  var badRendering = document.getElementById('badRendering');
  if (!badRendering) return;
  // All browsers supporting `.addEventListener' are reported to support
  // `.querySelectorAll' and the `^=' selector (IE9, Firefox 3+, Safari...)
  var keys = document.querySelectorAll('[id^="key_A"]');
  for (var i = 0; i < keys.length; i++) {
    if (parseInt(keys[i].getBoundingClientRect().width, 10) < 40) {
      badRendering.style.display = 'block';
      break;
    }
  }
}, false);

