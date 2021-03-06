
var inherits = require('util').inherits,
    inspect  = require('util').inspect,
    repeat   = require('./util').repeat,
    out      = process.stdout

var types = require('./types')

// http://stackoverflow.com/a/5450113
var repeat = function (pattern, count) {
  if (count < 1) { return '' }
  var result = ''
  while (count > 1) {
    if (count & 1) result += pattern;
    count >>= 1, pattern += pattern
  }
  return result + pattern
}

// TODO: Refactor all this crazy indentation stuff!
var INDENT = 2

var _ind = 0,
    _i   = function () { return repeat(' ', _ind) },
    _w   = function (s) { out.write(_i() + s) },
    _win = function (s) {
      // Indent and write
      _w(s); _ind += INDENT
    },
    _wout = function (s) { _ind -= INDENT; _w(s) },
    _include_types = true

// Nodes ----------------------------------------------------------------------

var Node = function () {}
Node.prototype.print = function () { out.write(inspect(this)) }
Node.prototype.compile = function (context) {
  throw new Error('Compilation not yet implemented for node type: '+this.constructor.name)
}
Node.prototype.setParsePosition = function (parser) {
  this._file   = parser.file
  this._line   = parser.line
  this._column = parser.column
}


function NameType (name) {
  this.name = name.trim()
}
inherits(NameType, Node)
NameType.prototype.toString = function () { return this.name }


function FunctionType (args, ret) {
  this.args = args
  this.ret  = ret
}
inherits(FunctionType, Node)
FunctionType.prototype.toString = function () {
  var args = this.args.map(function (arg) { return arg.toString() }).join(', '),
      ret  = (this.ret ? this.ret.toString() : 'Void')
  return '('+args+') -> '+ret
}


function Let (name, immediateType) {
  this.name          = name.trim()
  this.immediateType = immediateType
}
inherits(Let, Node)
Let.prototype.print    = function () { _w(this.toString()+"\n") }
Let.prototype.toString = function () {
  var ret = this.name
  if (_include_types && this.immediateType) {
    ret += ': '+this.immediateType.toString()
  }
  return ret
}


// Quick and dirty clone of Let
function Var (name, immediateType) {
  this.name          = name.trim()
  this.immediateType = immediateType
}
inherits(Var, Node)
Var.prototype.print    = Let.prototype.print
Var.prototype.toString = Let.prototype.toString


function Class (name, block) {
  this.name       = name
  this.definition = block
}
inherits(Class, Node)
Class.prototype.print = function () {
  out.write('class '+this.name+" ")
  this.definition.print()
}


var Expression = function () {}
inherits(Expression, Node)


function Group (expr) {
  this.expr = expr
}
inherits(Group, Expression)
Group.prototype.toString = function () { return '('+this.expr.toString()+')' }


function Binary (lexpr, op, rexpr) {
  this.lexpr = lexpr
  this.op    = op
  this.rexpr = rexpr
}
inherits(Binary, Expression)
Binary.prototype.isBinaryStatement = function () {
  return (this.op === '+=')
}
Binary.prototype.print = function () { out.write(this.toString()) }
Binary.prototype.toString = function () {
  return this.lexpr.toString()+' '+this.op+' '+this.rexpr.toString()
}


var Literal = function Literal (value, typeName) {
  this.value    = value
  this.typeName = (typeName !== undefined) ? typeName : null
  this.type     = null
}
inherits(Literal, Node)
Literal.prototype.print    = function () { out.write(this.toString()) }
Literal.prototype.toString = function () { return JSON.stringify(this.value) }


function Assignment (type, lvalue, op, rvalue) {
  this.type   = type
  this.lvalue = lvalue
  this.rvalue = rvalue
  // Possible values: '=', '+=', or null
  this.op     = op
  // Only allowed .op for lets/vars is a '='
  if ((this.type === 'let' || this.type === 'var') && this.op !== '=') {
    throw new Error('Invalid operator on '+this.type+" statement: '"+this.op+"'")
  }
}
inherits(Assignment, Node)
Assignment.prototype.print = function () {
  var type = (this.type != 'path') ? (this.type+' ') : ''
  out.write(type + this.lvalue.toString())
  if (this.rvalue) {
    var op = (this.op === null) ? '?' : this.op.toString()
    out.write(' '+op+' ')
    // _ind += INDENT
    this.rvalue.print()
    // _ind -= INDENT
  }
}


function Path (name, path) {
  this.name = name
  this.path = path
}
inherits(Path, Node)
Path.prototype.toString = function () {
  var ret = this.name
  this.path.forEach(function (item) {
    ret += item.toString()
  })
  return ret
}


function assertHasProperty (obj, prop) {
  var val = obj[prop]
  if (val !== undefined) { return }
  throw new Error("Object missing property '"+prop+"'")
}


function assertPropertyIsInstanceOf (recv, prop, type) {
  if (recv[prop] instanceof type) { return }
  throw new Error('Expected '+prop+' to be an instance of '+type.name)
}


// Compiler sanity check to make sure all the args have the correct properties
function assertSaneArgs (args) {
  for (var i = args.length - 1; i >= 0; i--) {
    var arg = args[i]
    assertHasProperty(arg, 'name')
    assertHasProperty(arg, 'type')
    // assertHasProperty(arg, 'def')
    var def = arg.def
    if (def && !(def instanceof Literal)) {
      throw new Error('Expected default to be an AST.Literal')
    }
  }// for
}// assertSaneArgs


function Function (args, ret, block) {
  this.args  = args
  this.ret   = ret
  this.block = block
  // Statement properties
  this.name  = null
  this.when  = null
  // Parent `multi` type (if this is present the Function will not
  // not codegen itself and instead defer to the Multi's codegen)
  this.parentMultiType = null
  // This will be set by type-system visitor later
  this.scope = null
  // Run some compiler checks
  assertPropertyIsInstanceOf(this, 'args', Array)
  assertSaneArgs(this.args)
}
inherits(Function, Node)
Function.prototype.print = function () {
  var args = this.args.map(function (arg) {
    var ret = arg.name
    if (arg.type) {
      ret += ': '+arg.type
    }
    return ret
  }).join(', ')
  out.write('func ('+args+') ')
  var instance = this.type
  if (this.ret) {
    out.write('-> '+this.ret+' ')
  } else {
    // If we computed an inferred return type for the type
    out.write('-i> '+instance.type.ret.inspect()+' ')
  }
  this.block.print()
}
Function.prototype.setParentMultiType = function (multi) {
  this.parentMultiType = multi
}
Function.prototype.isChildOfMulti = function () {
  return this.parentMultiType ? true : false
}


function Multi (name, args, ret) {
  this.name = name
  this.args = args
  this.ret  = ret
}
inherits(Multi, Node)
Multi.prototype.print = function () {
  var args = this.args.map(function (arg) {
    return arg.name+(arg.type ? (': '+arg.type) : '')
  }).join(', ')
  out.write('multi '+this.name+'('+args+")\n")
}


function Init (args, block) {
  this.args  = args
  this.block = block
  assertSaneArgs(this.args)
}
inherits(Init, Node)
Init.prototype.print = function () {
  var args = this.args.map(function (arg) { return arg.name+': '+arg.type.toString() }).join(', ')
  out.write('init ('+args+') ')
  this.block.print()
}


function New (name, args) {
  this.name = name
  this.args = args
}
inherits(New, Node)
New.prototype.toString = function () {
  var args = this.args.map(function(arg) { return arg.toString() }).join(', ')
  return 'new '+this.name+'('+args+')'
}
New.prototype.print = function () { out.write(this.toString()) }


function Call(args) {
  this.args = args
}
inherits(Call, Node)
Call.prototype.toString = function () {
  return '('+this.args.map(function (arg) { return arg.toString() }).join(', ')+')'
}

function Property (name) {
  this.name = name
}
inherits(Property, Node)
Property.prototype.toString = function () {
  return '.'+this.name
}


function If (cond, block, elseIfs, elseBlock) {
  this.cond      = cond
  this.block     = block
  this.elseIfs   = elseIfs ? elseIfs : null
  this.elseBlock = elseBlock ? elseBlock : null
}
inherits(If, Node)
If.prototype.print = function () {
  var cond = this.cond.toString()
  out.write("if "+cond+" ")
  this.block.print()
  if (this.elseIfs) {
    for (var i = 0; i < this.elseIfs.length; i++) {
      var ei = this.elseIfs[i]
      cond = ei.cond.toString()
      out.write(" else if "+cond+" ")
      ei.block.print()
    }
  }
  if (this.elseBlock) {
    out.write(" else ")
    this.elseBlock.print()
  }
}


function While (expr, block) {
  this.expr  = expr // Loop expression
  this.block = block
}
inherits(While, Node)
While.prototype.print = function () {
  out.write("while "+this.expr.toString()+" ")
  this.block.print()
}


function For (init, cond, after, block) {
  this.init  = init // Initialization
  this.cond  = cond // Condition
  this.after = after // Afterthought
  this.block = block
}
inherits(For, Node)
For.prototype.print = function () {
  out.write("for ")
  // Don't indent while we're writing out these statements
  var i = _ind
  _ind = 0;
  this.init.print();  out.write('; ')
  this.cond.print();  out.write('; ')
  this.after.print(); out.write(' ')
  // Restore indent and print the block
  _ind = i;
  this.block.print()
}


function Chain (name, tail) {
  this.name = name
  this.tail = tail
}
inherits(Chain, Node)
Chain.prototype.toString = function () {
  var base = this.name
  this.tail.forEach(function (expr) {
    base += expr.toString()
  })
  return base
}
Chain.prototype.print = function () { out.write(this.toString()) }


function Return (expr) {
  this.expr = expr
}
inherits(Return, Node)
Return.prototype.print    = function () { out.write(this.toString()) }
Return.prototype.toString = function () {
  if (this.expr) {
    return 'return '+this.expr.toString()
  }
  return 'return'
}


function Root (statements) {
  this.statements = statements
}
inherits(Root, Node)
Root.prototype.print = function (includeTypes) {
  if (includeTypes !== undefined) {
    _include_types = includeTypes
  }
  _win("root {\n")
  this.statements.forEach(function (stmt) {
    _w('')
    stmt.print()
    out.write("\n")
  })
  _wout("}\n");
}


function Block (statements) {
  this.statements = statements
}
inherits(Block, Node)
Block.prototype.print = function () {
  out.write("{\n")
  _ind += INDENT
  this.statements.forEach(function (stmt) {
    _w('')
    stmt.print()
    out.write("\n")
  })
  _ind -= INDENT
  _w('}')
  // out.write(repeat(' ', _ind - INDENT) + '}')
}


module.exports = {
  Node: Node,
  NameType: NameType,
  FunctionType: FunctionType,
  Class: Class,
  Init: Init,
  New: New,
  Let: Let,
  Var: Var,
  Path: Path,
  Root: Root,
  Assignment: Assignment,
  Expression: Expression,
  Binary: Binary,
  Literal: Literal,
  Group: Group,
  Function: Function,
  Multi: Multi,
  Block: Block,
  If: If,
  While: While,
  For: For,
  Chain: Chain,
  Return: Return,
  Call: Call,
  Property: Property
}
