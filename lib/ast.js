
var inherits = require('util').inherits,
    out      = process.stdout

// http://stackoverflow.com/a/5450113
var repeat = function (pattern, count) {
  if (count < 1) return '';
  var result = ''
  while (count > 1) {
    if (count & 1) result += pattern;
    count >>= 1, pattern += pattern
  }
  return result + pattern
}

var INDENT = 2

var _ind = 0,
    _i   = function () { return repeat(' ', _ind) },
    _w   = function (s) { out.write(_i() + s) },
    _win = function (s) {
      // Indent and write
      _w(s); _ind += INDENT
    },
    _wout = function (s) { _ind -= INDENT; _w(s) }


// Nodes ----------------------------------------------------------------------

var Node = function () {}
Node.prototype.print = function () { out.write(this.toString()) }


var Let = function Let(name, typepath) {
  this.name = name.trim()
  this.typepath = typepath
}
inherits(Let, Node)
Let.prototype.print    = function () { _w(this.toString()) }
Let.prototype.toString = function () { return this.name }


// Quick and dirty clone of Let
var Var = Let.bind({})
inherits(Var, Node)
Var.prototype.print    = Let.prototype.print
Var.prototype.toString = Let.prototype.toString


var Expression = function () {}
inherits(Expression, Node)


var Group = function Group(expr) {
  this.expr = expr
}
inherits(Group, Expression)
Group.prototype.toString = function () { return '('+this.expr.toString()+')' }


var Binary = function (lexpr, op, rexpr) {
  this.lexpr = lexpr
  this.op    = op
  this.rexpr = rexpr
}
inherits(Binary, Expression)
Binary.prototype.toString = function (argument) {
  return this.lexpr.toString()+' '+this.op+' '+this.rexpr.toString()
}


var Literal = function Literal(value) {
  this.value = value
}
inherits(Literal, Node)
Literal.prototype.toString = function () {
  return this.value.toString()
}


var Assignment = function (type, lvalue, rvalue) {
  this.type   = type
  this.lvalue = lvalue
  this.rvalue = rvalue
}
inherits(Assignment, Node)
Assignment.prototype.print = function () {
  var type = this.type ? (this.type+' ') : ''
  _w(type+this.lvalue.toString()+' = ')
  if (this.rvalue) {
    _ind += INDENT
    this.rvalue.print()
    _ind -= INDENT
  }
  out.write("\n")
}


var Path = function () {}
inherits(Path, Node)


var Root = function (statements) {
  this.statements = statements
}
inherits(Root, Node)
Root.prototype.print = function() {
  _win("root {\n")
  this.statements.forEach(function (stmt) {
    stmt.print()
  })
  _wout("}\n");
}


module.exports = {
  Node: Node,
  Let: Let,
  Var: Var,
  Path: Path,
  Root: Root,
  Assignment: Assignment,
  Expression: Expression,
  Binary: Binary,
  Literal: Literal,
  Group: Group
}
