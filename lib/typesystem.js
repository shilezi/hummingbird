
var inherits  = require('util').inherits,
    types     = require('./types'),
    AST       = require('./ast'),
    Scope     = require('./typesystem/scope'),
    TypeError = require('./typesystem/typeerror')

var inspect = require('util').inspect


function TypeSystem () {
  this.root = new Scope()
  this.root.isRoot = true
  this.bootstrap()
}
// Add the bootstrap methods to the TypeSystem
require('./typesystem/bootstrap')(TypeSystem)

TypeSystem.prototype.findByName = function (name) {
  if (typeof name !== 'string') {
    throw new Error('Non-string name for type lookup')
  }
  return this.root.getLocal(name)
}

function assertInstanceOf(value, type, msg) {
  if (value instanceof type) { return; }
  throw new Error(msg)
}


// AST typing -----------------------------------------------------------------

TypeSystem.prototype.walk = function (rootNode) {
  assertInstanceOf(rootNode, AST.Root, "Node must be root")

  var self = this
  var topLevelScope = new Scope(this.root)
  rootNode.statements.forEach(function (stmt) {
    self.visitStatement(stmt, topLevelScope, rootNode)
  })
}

TypeSystem.prototype.visitBlock = function (node, scope) {
  var self = this
  node.statements.forEach(function (stmt) {
    self.visitStatement(stmt, scope, node)
  })
}

TypeSystem.prototype.visitStatement = function (node, scope, parentNode) {
  switch (node.constructor) {
    case AST.Assignment:
      if (node.lvalue instanceof AST.Let) {
        this.visitLet(node, scope)
      } else if (node.lvalue instanceof AST.Var) {
        this.visitVar(node, scope)
      } else if (node.lvalue instanceof AST.Path) {
        this.visitPath(node, scope)
      } else {
        throw new TypeError('Cannot visit Assignment with: '+node.lvalue+' ('+node.lvalue.constructor.name+')')
      }
      break
    case AST.If:
      this.visitIf(node, scope)
      break
    case AST.While:
      this.visitWhile(node, scope)
      break
    case AST.For:
      this.visitFor(node, scope)
      break
    case AST.Return:
      this.visitReturn(node, scope, parentNode)
      break
    case AST.Binary:
      if (node.isBinaryStatement()) {
        this.visitBinary(node, scope)
      } else {
        throw new TypeError('Cannot visit non-statement binary: '+node.op)
      }
      break
    case AST.Chain:
      this.visitChain(node, scope)
      break
    case AST.Multi:
      this.visitMulti(node, scope)
      break
    case AST.Function:
      // Create the searcher in this parent node
      // TODO: Maybe just pass along the parent node rather than generating
      //       a whole new anonymous function every time we encounter a
      //       function statement?
      var searchInParent = function (cb) {
        var statements = parentNode.statements,
            found      = null
        // Call `cb` on each statement of the parent until it returns true
        for (var i = statements.length - 1; i >= 0; i--) {
          var stmt = statements[i],
              ret  = cb(stmt)
          if (ret === true) {
            found = stmt
            break
          }
        }
        return found
      }
      this.visitFunctionStatement(node, scope, searchInParent)
      break
    case AST.Class:
      this.visitClass(node, scope)
      break
    default:
      throw new TypeError("Don't know how to visit: "+node.constructor.name, node)
      break
  }
}


TypeSystem.prototype.visitClass = function (node, scope) {
  var rootObject = this.rootObject
  // Create a new Object type with the root object as the supertype
  var klass = new types.Object(rootObject)
  klass.name = node.name
  scope.setLocal(klass.name, klass)
  // Now create a new scope and visit the definition in that scope
  var scope = new Scope(scope)
  this.visitClassDefinition(node.definition, scope, klass)
  // Set the class as the node's type
  node.type = klass
}
TypeSystem.prototype.visitClassDefinition = function (node, scope, klass) {
  var self = this
  // Create the parent scope for functions and other blocks
  var thisScope = new Scope(scope)
  thisScope.setLocal('this', new types.Instance(klass))

  node.statements.forEach(function (stmt) {
    switch (stmt.constructor) {
      case AST.Assignment:
        if (stmt.type !== 'var' && stmt.type !== 'let') {
          throw new TypeError('Unexpected assignment type: '+stmt.type, stmt)
        }
        var propertyName = stmt.lvalue.name
        // Check that there's a type specified for this slot
        if (!stmt.lvalue.immediateType) {
          throw new TypeError('Missing type for class slot: '+propertyName)
        }
        var propertyType = self.resolveType(stmt.lvalue.immediateType, scope)
        // Check that the default (rvalue) is constant if present
        // TODO: Smarter checking of constant-ness of default values when it's "let"
        if (stmt.rvalue && !(stmt.rvalue instanceof AST.Literal)) {
          throw new TypeError('Cannot handle non-literal default for property: '+propertyName)
        }
        // Create the property on the object with the resolved type
        klass.setTypeOfProperty(propertyName, propertyType)
        // TODO: Add read-only flags when the assignment .type is "let"
        break
      case AST.Function:
        self.visitClassFunction(stmt, thisScope, klass)
        break
      case AST.Init:
        var initType = new types.Function(self.rootObject),
            initScope = new Scope(thisScope)
        // Resolve the arguments
        var args = []
        stmt.args.forEach(function (arg) {
          var type = self.resolveType(arg.type)
          initScope.setLocal(arg.name, new types.Instance(type))
          args.push(type)
        })
        initType.args = args
        // Then visit the block with the new scope
        self.visitBlock(stmt.block, initScope)
        klass.addInitializer(initType)
        break
      default:
        console.log(stmt)
        throw new TypeError("Don't know how to visit '"+stmt.constructor.name+"' in class definition")
        break
    }
  })
}
TypeSystem.prototype.visitClassFunction = function (node, thisScope, klass) {
  var functionName = node.name
  // Check that it's a function statement (ie. has a name)
  if (!functionName) {
    throw new TypeError('Missing function name', node)
  }
  // Run the generic visitor to figure out argument and return types
  this.visitFunction(node, thisScope)
  var functionInstance = node.type
  // Unbox the instance generated by the visitor to get the pure
  // function type
  var functionType = functionInstance.type
  // Add that function type as a property of the class
  // TODO: Maybe have a separate dictionary for instance methods
  klass.setTypeOfProperty(functionName, functionType)
}


TypeSystem.prototype.visitFor = function (node, scope) {
  this.visitStatement(node.init, scope)

  // If there's a condition present then we need to visit the expression
  // and type-check what it resolves to
  if (node.cond) {
    this.visitExpression(node.cond, scope)
    var condType = node.cond.type
    if (!condType) {
      throw new TypeError('Missing type of `for` condition', node.cond)
    }
    // Check that the condition resolves to a boolean
    if (!condType.equals(this.findByName('Boolean'))) {
      throw new TypeError('Expected `for` condition to resolve to a Boolean', node.cond)
    }
  }

  this.visitStatement(node.after, scope)

  var blockScope = new Scope(scope)
  this.visitBlock(node.block, blockScope)
}

TypeSystem.prototype.visitIf = function (node, scope) {
  assertInstanceOf(node.block, AST.Block, 'Expected Block in If statement')

  this.visitExpression(node.cond, scope)

  // Handle the main if block
  var blockScope = new Scope(scope)
  this.visitBlock(node.block, blockScope)

  // Visit each of the else-ifs
  if (node.elseIfs) {
    for (var i = 0; i < node.elseIfs.length; i++) {
      var elseIf = node.elseIfs[i],
          elseIfBlockScope = new Scope(scope)
      this.visitExpression(elseIf.cond, scope)
      this.visitBlock(elseIf.block, elseIfBlockScope)
    }
  }
  // Handle the else block if present
  if (node.elseBlock) {
    var elseBlockScope = new Scope(scope)
    this.visitBlock(node.elseBlock, elseBlockScope)
  }
}

TypeSystem.prototype.visitWhile = function (node, scope) {
  assertInstanceOf(node.block, AST.Block, 'Expected Block in While statement')

  this.visitExpression(node.expr, scope)

  var blockScope = new Scope(scope)
  this.visitBlock(node.block, blockScope)
}

TypeSystem.prototype.visitReturn = function (node, scope, parentNode) {
  if (node.expr === undefined) {
    throw new TypeError('Cannot handle undefined expression in Return')
  }
  var exprType = null
  if (node.expr === null) {
    var voidType = this.root.getLocal('Void')
    exprType = new types.Instance(voidType)
  } else {
    var expr = node.expr
    exprType = this.resolveExpression(expr, scope)
  }
  node.type = exprType
  // Handle the parent block if present
  if (parentNode) {
    if (!((parentNode instanceof AST.Block) || (parentNode instanceof AST.Root))) {
      throw new TypeError('Expected Block or Root as parent of Return', node)
    }
    // assertInstanceOf(parentNode, AST.Block, 'Expected Block as parent of Return')
    if (parentNode.returnType) {
      throw new TypeError('Block already has returned')
    }
    // The expression should return an instance, we'll have to unbox that
    assertInstanceOf(exprType, types.Instance, 'Expected Instance as argument to Return')
    parentNode.returnType = exprType ? exprType.type : null
  }
}

TypeSystem.prototype.visitPath = function (node, scope) {
  var path = node.lvalue
  var foundScope = scope.findScopeForName(path.name)
  if (foundScope === null) {
    throw new TypeError('Failed to find '+path.name)
  }
  var lvalueType = foundScope.get(path.name, node)
  // Now revise that type according to the path
  path.path.forEach(function (item) {
    switch (item.constructor) {
      case AST.Property:
        if (!(lvalueType instanceof types.Instance)) {
          throw new TypeError('Cannot get property of non-Instance', item)
        }
        var propertyName = item.name
        // Unbox the lvalue instance
        var instance = lvalueType
            type     = instance.type
        // Finally look up the type of the property and box it up
        var newType = type.getTypeOfProperty(propertyName, item)
        lvalueType = new types.Instance(newType)
        break
      default:
        throw new TypeError('Cannot handle item in path of type: '+item.constructor.name, node)
    }
  })

  var rvalueType = this.resolveExpression(node.rvalue, scope)
  if (!lvalueType.equals(rvalueType)) {
    throw new TypeError('Unequal types in assignment: '+lvalueType.inspect()+' </> '+rvalueType.inspect(), node)
  }
}

TypeSystem.prototype.resolveType = function (node, scope) {
  var self = this
  switch (node.constructor) {
    case AST.FunctionType:
      var args = node.args.map(function (arg) { return self.resolveType(arg, scope) }),
          ret  = this.resolveType(node.ret, scope)
      // Build the type and return it
      return new types.Function(this.rootObject, args, ret)
    case AST.NameType:
      // TODO: Improve the handling and look-ups of these; right now they're way too naive
      return this.findByName(node.name)
    default:
      throw new Error("Can't walk: "+node.constructor.name)
  }
}

TypeSystem.prototype.visitLet = function (node, scope) {
  var lvalueType = new types.Unknown()
  var name       = node.lvalue.name

  // If we have an explicit type then look it up
  if (node.lvalue.immediateType) {
    var immediateTypeNode = node.lvalue.immediateType
    // lvalueType = this.findByName(...)
    lvalueType = this.resolveType(immediateTypeNode, scope)
    // Box the type into an instance
    lvalueType = new types.Instance(lvalueType)
  }

  // Create a scope inside the Let statement for recursive calls
  var letScope = new Scope(scope)
  letScope.setLocal(name, lvalueType)

  if (node.rvalue) {
    // rvalue is an expression so let's determine its type first.
    var rvalueType = this.resolveExpression(node.rvalue, letScope, function (immediateType) {
      if (lvalueType instanceof types.Unknown) {
        // If the lvalue is unknown then annotate it with the resolved type
        lvalueType.known = new types.Instance(immediateType)
      }
    })
    if (lvalueType instanceof types.Unknown) {
      // If the lvalue was inferred then update on the lvalue
      node.lvalue.type = rvalueType
      scope.setLocal(name, rvalueType)
    } else {
      // If the lvalue type is explicit then make sure they match up
      if (!lvalueType.equals(rvalueType)) {
        var message = 'Unequal types in declaration: '+lvalueType.inspect()+' </> '+rvalueType.inspect()
        throw new TypeError(message, node)
      }
      scope.setLocal(name, lvalueType)
    }

  } else {
    // No rvalue present
    node.lvalue.type = lvalueType
    scope.setLocal(name, lvalueType)
  }
}
// Alias the var visitor to the let visitor
TypeSystem.prototype.visitVar = TypeSystem.prototype.visitLet


TypeSystem.prototype.resolveExpression = function (expr, scope, immediate) {
  // If we've already deduced the type of this then just return it
  if (expr.type) { return expr.type }

  this.visitExpression(expr, scope, immediate)

  if (expr.type === null || expr.type === undefined) {
    throw new TypeError('Failed to resolve type')
  }
  return expr.type
}

TypeSystem.prototype.visitExpression = function (node, scope, immediate) {
  switch (node.constructor) {
    case AST.Function:
      // Sanity checks to make sure the name and when are not present
      if (node.name) {
        throw new TypeError('Function expression cannot have a `name`', node)
      }
      if (node.when) {
        throw new TypeError('Function expression cannot have a `when` condition', node)
      }
      // Then run the visitor
      this.visitFunction(node, scope, immediate)
      break
    case AST.Binary:
      this.visitBinary(node, scope)
      break
    case AST.Chain:
      this.visitChain(node, scope)
      break
    case AST.Literal:
      this.visitLiteral(node, scope)
      break
    case AST.New:
      this.visitNew(node, scope)
      break
    default:
      throw new Error("Can't walk: "+node.constructor.name)
  }
}

TypeSystem.prototype.visitLiteral = function (node, scope) {
  // If we've already identified the type
  if (node.type) {
    return node.type
  } else if (node.typeName) {
    var type  = this.findByName(node.typeName)
    node.type = new types.Instance(type)
    return type
  } else {
    throw new TypeError('Unknown literal type: '+node.typeName)
  }
}

TypeSystem.prototype.visitNew = function (node, scope) {
  // Look up the type of what we're going to construct
  var type = scope.get(node.name)
  node.constructorType = type
  // Construct an instance of that type
  var instance = new types.Instance(type)
  node.type = instance
  if (type.initializers.length === 0) {
    throw new TypeError('No initializer found for class', node)
  }
  // TODO: Find a matching initializer
  var initializer  = type.initializers[0]
  node.initializer = initializer
}

var COMPARATOR_OPS = ['<']

TypeSystem.prototype.visitBinary = function (node, scope) {
  var lexprType = this.resolveExpression(node.lexpr, scope)
  var rexprType = this.resolveExpression(node.rexpr, scope)

  assertInstanceOf(lexprType, types.Instance, 'Expected Instance in L-value')
  assertInstanceOf(rexprType, types.Instance, 'Expected Instance in R-value')
  if (lexprType.equals(rexprType)) {
    // Naive type assignment based off left side; this is refined below
    node.type = lexprType
  } else {
    throw new TypeError('Unequal types in binary operation: '+lexprType.inspect()+' </> '+rexprType.inspect())
  }
  // TODO: Check adder, comparator, etc. interfaces of the left and right
  var op = node.op
  if (COMPARATOR_OPS.indexOf(op) !== -1) {
    node.type = this.findByName('Boolean')
  }
}

function getAllReturnTypes (block) {
  var returnTypes = []
  if (block.returnType) { returnTypes.push(block.returnType) }

  block.statements.forEach(function (stmt) {
    var types = null
    switch (stmt.constructor) {
      case AST.If:
        types = getAllReturnTypes(stmt.block)
        if (stmt.elseBlock) {
          types = types.concat(getAllReturnTypes(stmt.elseBlock))
        }
        returnTypes = returnTypes.concat(types)
        break
      case AST.While:
      case AST.For:
        types = getAllReturnTypes(stmt.block)
        returnTypes = returnTypes.concat(types)
        break
    }
  })
  return returnTypes
}

TypeSystem.prototype.visitFunction = function (node, parentScope, immediate) {
  if (node.type) { return node.type }
  var self = this
  var type = new types.Function(this.rootObject)
  // Set the type of this node to an instance of the function type
  node.type = new types.Instance(type)

  if (node.ret) {
    type.ret = this.resolveType(node.ret)
  }

  // If we have a callback for the immediate (not-yet-fully resolved type)
  // then call it now.
  if (immediate !== undefined) {
    immediate(type)
  }

  var functionScope = new Scope(parentScope)
  // Save this new scope on the node object for later use
  node.scope = functionScope

  // Build up the args to go into the type definition
  var typeArgs = []
  node.args.forEach(function (arg) {
    // Deprecated simplistic type lookup:
    //   var argType = self.findByName(arg.type)
    var argType = self.resolveType(arg.type)
    // Setup a local Instance in the function's scope for the argument
    functionScope.setLocal(arg.name, new types.Instance(argType))
    // Add the type to the type's args
    typeArgs.push(argType)
  })
  type.args = typeArgs

  // Begin by visiting our block
  this.visitBlock(node.block, functionScope)

  // Get all possible return types of this function (recursively collects
  // returning child blocks).
  var returnTypes = getAllReturnTypes(node.block)

  // If there is a declared return type then we need to check that all the found
  // returns match that type
  if (type.ret) {
    returnTypes.forEach(function (returnType) {
      if (!type.ret.equals(returnType)) {
        throw new TypeError('Type returned by function does not match declared return type')
      }
    })
    return
  }

  // Otherwise we need to try to unify the returns; this could potentially be
  // a very expensive operation, so we'll warn the user if they do too many
  if (returnTypes.length > 4) {
    var returns = returnTypes.length,
        file    = node._file,
        line    = node._line,
        warning = "Warning: Encountered "+returns+" return statements in function\n"+
                  "  Computing type unions can be expensive and should be used carefully!\n"+
                  "  at "+file+":"+line+"\n"
    process.stderr.write(warning)
  }
  // Slow quadratic uniqueness checking to reduce the set of return types
  // to distinct ones
  var reducedTypes = uniqueWithComparator(returnTypes, function (a, b) {
    return a.equals(b)
  })
  if (reducedTypes.length > 1) {
    var t = reducedTypes.map(function (t) { return t.inspect() }).join(', ')
    throw new TypeError('Too many return types (have '+t+')', node)
  }
  // Final return type
  var returnType = null
  if (reducedTypes.length !== 0) {
    returnType = reducedTypes[0]
  }
  // Update the type definition (if there we 0 then it will be null which is
  // Void in the type-system)
  type.ret = returnType
}

function uniqueWithComparator (array, comparator) {
  var acc    = [],
      length = array.length
  for (var i = 0; i < length; i++) {
    for (var j = i + 1; j < length; j++) {
      var a = array[i],
          b = array[j]
      if (comparator(a, b)) { j = ++i }
    }
    acc.push(array[i])
  }
  return acc
}


TypeSystem.prototype.visitFunctionStatement = function (node, scope, searchInParent) {
  var name = node.name
  // Now look up the parent `multi` in the containing block
  var multiNode = searchInParent(function (stmt) {
    if (stmt.constructor === AST.Multi && stmt.name === name) {
      return true
    }
    return false
  })
  if (!multiNode) {
    throw new TypeError('Failed to find associated multi statement')
  }
  var multiType = multiNode.type
  // Add this implementation to its list of functions and set the parent of
  // the function so that it knows not to codegen itself
  multiType.addFunctionNode(node)
  node.setParentMultiType(multiNode.type)

  // Fill out any missing types
  for (var i = 0; i < node.args.length; i++) {
    var arg = node.args[i]
    // Type is specified so we don't need to worry about it
    if (arg.type) { continue }
    // Set the argument's type to the multi argument's type
    arg.type = multiNode.args[i].type
  }

  // First run the generic function visitor
  this.visitFunction(node, scope)
  // Type-system checks
  if (typeof node.name !== 'string') {
    throw new TypeError('Non-string name for function statement', node)
  }
  assertInstanceOf(node.scope, Scope, "Missing function's scope")
  // Now do statement-level visiting
  if (node.when) {
    this.visitExpression(node.when, node.scope)
  }
}


// Resolve an Unknown type to a known one (sort of a second pass) or throw
// an error if it's still unknown
var know = function (node, type) {
  if (type instanceof types.Unknown) {
    if (type.known === null) {
      throw new TypeError('Unknown type')
    }
    return type.known
  }
  return type
}

TypeSystem.prototype.visitChain = function (node, scope) {
  var self = this
  var type = know(node, scope.get(node.name, node))
  node.tail.forEach(function (item) {
    if (item instanceof AST.Call) {
      // Make sure we're trying to call an instance
      assertInstanceOf(type, types.Instance, 'Unexpected non-Instanced Function')
      // Get the type of the instance
      type = type.type
      assertInstanceOf(type, types.Function, 'Trying to call non-Function')
      var typeArgs = type.args,
          itemArgs = item.args
      // Check to make sure we're getting as many arguments as we expected
      if (typeArgs.length !== itemArgs.length) {
        var t = typeArgs.length, i = itemArgs.length
        throw new TypeError('Wrong number of arguments: expected '+t+', got '+i)
      }
      // Then type-check each individual arguments
      for (var i = itemArgs.length - 1; i >= 0; i--) {
        // Visit each argument item
        var itemArg = itemArgs[i]
        self.visitExpression(itemArg, scope)
        // Get the Instance type of the passing argument node
        var itemArgInstance = itemArg.type
        // Verify that the passed argument's type is an Instance box
        var failureMessage = 'Expected Instance as function argument, got: '+itemArgInstance.inspect()
        assertInstanceOf(itemArgInstance, types.Instance, failureMessage)
        // Unbox the instance
        var itemArgType = itemArgInstance.type
        // Then get the type from the function definition to compare to the
        // passed argument
        var typeArg = typeArgs[i]
        if (!typeArg.equals(itemArgType)) {
          var message  = 'Argument mismatch at argument index '+i,
              got      = itemArgType.inspect(),
              expected = typeArg.inspect()
          message += "\n  expected "+expected+', got '+got
          throw new TypeError(message, item)
        }
      }
      // Replace current type with an instance of type that's going to be returned
      var returnType = type.ret
      type = new types.Instance(returnType)

    } else
    if (item instanceof AST.Property) {
      // Can only get properties of Instances right now
      assertInstanceOf(type, types.Instance, 'Trying to get property of non-Instance')
      var instance     = type,
          propertyType = instance.getTypeOfProperty(item.name)
      // Set the type to an Instance of the property
      type = new types.Instance(propertyType)

    } else {
      throw new TypeError('Cannot handle Chain item of type: '+item.constructor.name, node)
    }
  })
  node.type = type
}


TypeSystem.prototype.visitMulti = function (node, scope) {
  var self = this
  // Construct a new array of name-type args
  var args = node.args.map(function (arg) {
    var name = arg.name,
        type = self.resolveType(arg.type)
    return {name: name, type: type}
  })
  if (!node.ret) {
    throw new TypeError('Missing multi return type', node)
  }
  var ret = this.resolveType(node.ret)
  // Construct Multi type with the arguments and return types
  var multi = new types.Multi(this.rootObject, args, ret)
  node.type = multi
  // Add multi to the scope
  scope.setLocal(node.name, multi)
}


module.exports = {TypeSystem: TypeSystem}
