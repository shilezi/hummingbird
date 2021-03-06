[![Build Status][travis-image]][travis-url]
[![Coverage Status][coveralls-image]][coveralls-url]

# Hummingbird

Hummingbird is a language inspired by JavaScript, ML, and Swift. It features/will feature a usable type system with ML-inspired type inference, JavaScript code generation, and a concise syntax designed for readability.

### Example

An obligatory hello world:

```go
let welcome: String = "Hello "
func sayHello () -> Boolean {
  console.log(welcome + "world")
  return true
}
sayHello()
```

For more examples see the [specification](doc/specification.md) and [manual](doc/Manual.md).

## Getting started

The quickest way to get started is to clone the repository and use that directly. This language is actively being built out, so many features you would expect may be missing.

```bash
git clone git@github.com:dirk/hummingbird.git
cd hummingbird
# Run the command-line tool with no arguments to see the options
bin/hb
# To see the parsed and type-checked AST of a file
bin/hb inspect examples/simple.js
# To compile and run a file
bin/hb run examples/simple.js
```

### Contributing

To contribute just [fork][fork] the repository, commit your changes on a branch on your fork, and [create a pull request][pull]!

If you're planning to introduce significant changes/features, then we highly suggest creating an issue with the "Proposal" label ahead-of-time so that everyone can contribute to a discussion before starting to commit development time. We really don't want to have to needlessly turn down pull requests!

[fork]: https://github.com/dirk/hummingbird/fork
[pull]: https://github.com/dirk/hummingbird/compare

## Specification

The Hummingbird [specification](doc/specification.md) is designed to be both human- and machine-readable. It is organized into sections for each syntactical and semantic feature of the language.

Each feature has a `<spec name="..."></spec>` block containing the Hummingbird example source and the expected JavaScript output. These can then be parsed and a full suite of unit tests generated in `test/spec/`.

```bash
# Generating the spec tests
npm run gen-spec
# Running those tests
npm run test-spec
```

## License

Released under the Modified BSD License. See [LICENSE](LICENSE) for details.

[travis-image]: https://img.shields.io/travis/dirk/hummingbird/master.svg?style=flat-square
[travis-url]: https://travis-ci.org/dirk/hummingbird
[coveralls-image]: https://img.shields.io/coveralls/dirk/hummingbird/master.svg?style=flat-square
[coveralls-url]: https://coveralls.io/r/dirk/hummingbird

