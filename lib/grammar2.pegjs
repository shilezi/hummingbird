{// Begin preamble
  var p = {}

  function transformArgs (args) {
    var head = args[0], tail = args[2]
    return [head].concat(tail.map(function (ti) {
      return ti[2]
    }))
  }

  p.setPosition = function (line, column) {
    this.line   = line
    this.column = column
    this.file   = options.file
    // console.log('setPosition('+line+', '+column+')')
    return false
  }

  // Forward declarations that will be overwritten parser-extension.js
  p.parseDeclaration = function (lvalue, rvalue) { return [lvalue, rvalue] }
  p.parseClass = function (name, block) { return [name, block] }
  p.parseBlock = function (statements) { return statements }
  p.parseIf = function (cond, block) { return [cond, block] }
  p.parseRoot = function (statements) { return statements }
  p.parseBinary = function (left, op, right) { return [left, op, right] }
  p.parseInteger = function (integerString) { return integerString }
  p.parseLeftDeclaration = function (decl, name, type) { return [decl, name, type] }
  p.parseFunction = function (name, args, returnType, whenCond, block) { return [name, args, returnType, whenCond, block] }
  p.parseFor = function (init, cond, after, block) { return [init, cond, after, block] }
  p.parseWhile = function (cond, block) { return [cond, block] }
  p.parseIf = function (cond, block) { return [cond, block] }
  p.parseChain = function (name, tail) { return [name, tail] }
  p.parseAssignment = function (path, op, expr) { return [path, op, expr] }
  p.parseReturn = function (expr) { return [expr] }
  p.parseCall = function (expr) { return [expr] }
  p.parsePath = function (name, path) { return [name, path] }
  p.parseNameType = function (name) { return [name] }
  p.parseFunctionType = function (args, ret) { return [args, ret] }
  p.parseMutli = function (name, args, ret) { return [name, args, ret] }
  p.parseProperty = function (name) { return [name] }

  if (typeof require !== 'undefined') {
    require('./parser-extension')(p)
  }
}// End preamble


start = __ s:statements __ { return p.parseRoot(s) }

statements = statement*

// Statements must be ended by a newline, semicolon, end-of-file, or a
// look-ahead right curly brace for end-of-block.
terminator = _ comment? ("\n" / ";" / eof / &"}") __

block = "{" __ s:statements __ "}" { return p.parseBlock(s) }

statement = s:innerstmt terminator { return s }

innerstmt = decl
          / ctrl
          / assg
          / multistmt
          / funcstmt
          / expr

ctrl = ifctrl
     / whilectrl
     / forctrl
     / returnctrl

ifctrl     = "if" _ c:innerstmt _ b:block { return p.parseIf(c, b) }
whilectrl  = "while" _ c:innerstmt _ b:block { return p.parseWhile(c, b) }
forctrl    = "for" _ i:innerstmt? _ ";" _ c:innerstmt? _ ";" _ a:innerstmt? _ b:block { return p.parseFor(i, c, a, b) }
returnctrl = "return" e:(_ e:expr)? { return p.parseReturn(e ? e[1] : null) }

decl = letvardecl
     / classdecl

classdecl = pos "class" whitespace n:name _ b:block { return p.parseClass(n, b) }

// Declaration via let or var keywords
letvardecl = pos lvalue:leftdecl rvalue:(_ "=" _ expr)? { return p.parseDeclaration(lvalue, rvalue ? rvalue[3] : false) }
leftdecl = pos k:("let" / "var") whitespace n:name t:(":" whitespace type)? { return p.parseLeftDeclaration(k, n, t ? t[2] : null) }

assg = path:path _ op:assgop _ e:expr { return p.parseAssignment(path, op, e) }
assgop = "="
       / "+="

// Path assignment of existing variables and their indexes/properties
path = n:name path:(indexer / property)* { return p.parsePath(n, path) }
indexer = "[" _ expr _ "]"
property = "." n:name { return p.parseProperty(n) }

multistmt = pos "multi" whitespace n:name _ a:args _ r:ret? { return p.parseMutli(n, a, r) }

expr = binaryexpr

// Binary expressions have highest precedence
binaryexpr = le:unaryexpr _ op:binaryop _ re:binaryexpr { return p.parseBinary(le, op, re) }
           / unaryexpr


unaryexpr = "!" e:groupexpr { return e }
          / groupexpr

groupexpr = "(" e:expr ")" { return e }
          / basicexpr

basicexpr = funcexpr
          / literalexpr
          / chainexpr

chainexpr = pos n:name t:(indexer / property / call)* { return p.parseChain(n, t) }
call = pos "(" _ args:(expr _ ("," _ expr _)* )? _ ")" { return p.parseCall(args ? transformArgs(args) : []) }

literalexpr = i:integer { return p.parseInteger(i) }

funcstmt = pos "func" whitespace n:name _ a:args _ r:ret? _ w:when? _ b:block { return p.parseFunction(n, a, r, w, b) }
funcexpr = pos "func" _ a:args _ r:ret? _ b:block { return p.parseFunction(null, a, r, null, b) }
args     = "(" _ list:arglist? _ ")" { return (list ? list : []) }
arglist  = ( h:arg _ t:("," _ arg _)* ) { return [h].concat(t.map(function (ti) { return ti[2] })) }
arg      = n:argname _ t:(":" _ type)? _ d:("=" _ literalexpr)? { return {name: n, type: (t ? t[2] : null), def: (d ? d[2] : null)} }
argname  = "_" { return text() }
         / name
ret      = "->" whitespace t:type { return t }
when     = "when" _ "(" _ e:expr _ ")" { return e }

// Building blocks

name = [A-Za-z] [A-Za-z0-9_]* { return text() }
type = nametype / functype

nametype = [A-Z] [A-Za-z0-9_]* { return p.parseNameType(text()) }
functype = "(" _ args:argtypelist? _ ")" _ "->" _ ret:type { return p.parseFunctionType(args, ret) }
argtypelist = ( h:type _ t:("," _ type _)* ) { return [h].concat(t.map(function (ti) { return ti[2] })) }

// Literals

integer = "0"
        / ("-"? [1-9] [0-9]*) { return text() }

binaryop  = "+"
          / "+"
          / "-"
          / "*"
          / "/"
          / "%"
          / "=="
          / "||"
          / "<"
          / ">"

__ = (comment / "\n" / whitespace)*

// A comment is a pound sign, followed by anything but a newline,
// followed by a non-consumed newline.
comment = "#" [^\n]* &"\n"

whitespace = " " / "\t"
_ = whitespace*


// Utility to be added onto the end of rules to set position info
pos = ! { return p.setPosition(line(), column()) }

eof = !.
