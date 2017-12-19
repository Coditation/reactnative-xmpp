
function Element (elem, parent, attrs, prefix, uri) {
  this.name = elem;
  this.attributes = attrs || {};
  this.prefix = prefix || '';
  this.uri = uri || '';
  this.children = [];
  this.nodeValue = '';
  this.cdata = '';
  this.parent = parent;
  if (this.parent) {
    this.parent.children.push(this);
  }
}

Element.prototype.getElementsByTagName = function (tag_name) {
  var tmp = [];
  this.children.forEach(function (node) {
    node.getElementsByTagName(tag_name).forEach(function (match) {
      tmp.push(match);
    });
    if (node.name === tag_name && node.uri === '') {
      tmp.push(node);
    }
  });
  return tmp;
};

Element.prototype.getElementsByTagNameNS = function (ns, tag_name) {
  var tmp = [];
  this.children.forEach(function (node) {
    node.getElementsByTagNameNS(ns, tag_name).forEach(function (match) {
      tmp.push(match);
    })
    if (node.name === tag_name && node.uri === ns) {
      tmp.push(node);
    }
  });
  return tmp;
};

Element.prototype.getAttribute = function (attribute_name) {
  var value = null;
  for (var k = 0; k < this.attributes.length; k++) {
    if (this.attributes[k][0] === attribute_name) {
      return this.attributes[k][1];
    }
  }
  return false;
};

module.exports = {
  "Element": Element
}