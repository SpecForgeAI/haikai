# Structural Samples — js-express

Showing 10 of 71 complex files.

These are what the LLM receives instead of raw source code.


## /tmp/test-js-express/examples/auth/index.js
```
Symbols:
  variable: express
  variable: hash
  variable: path
  variable: session
  variable: app
  function: AnonymousFunctionbdbd74560100(req, res, next)
  class: users
    class: tj
  function: AnonymousFunctionbdbd74560200(err, pass, salt, hash)
  function: authenticate(name, pass, fn)
    function: AnonymousFunctionbdbd74560300(err, pass, salt, hash)
  function: restrict(req, res, next)
  function: AnonymousFunctionbdbd74560400(req, res)
  function: AnonymousFunctionbdbd74560500(req, res)
  function: AnonymousFunctionbdbd74560600(req, res)
  function: AnonymousFunctionbdbd74560700()
  function: AnonymousFunctionbdbd74560800(req, res)
  function: AnonymousFunctionbdbd74560900(req, res, next)
    function: AnonymousFunctionbdbd74560a00(err, user)
  function: AnonymousFunctionbdbd74560b00()

Calls:
  <module>:
    -> require (line 7, external)
    -> require (line 8, external)
    -> require (line 9, external)
    -> require (line 10, external)
    -> express (line 12, external)
    -> app.set (line 16, external)
    -> app.set (line 17, external)
    -> path.join (line 17, external)
    -> app.use (line 21, external)
    -> express.urlencoded (line 21, external)
    -> app.use (line 22, external)
    -> session (line 22, external)
    -> app.use (line 30, external)
    -> next (line 38, external)
    -> hash (line 50, external)
    -> app.get (line 84, external)
    -> res.redirect (line 85, external)
    -> app.get (line 88, external)
    -> res.send (line 89, external)
    -> app.get (line 92, external)
    -> req.session.destroy (line 95, external)
    -> res.redirect (line 96, external)
    -> app.get (line 100, external)
    -> res.render (line 101, external)
    -> app.post (line 104, external)
    -> res.sendStatus (line 105, external)
    -> authenticate (line 106, external)
    -> next (line 107, external)
    -> req.session.regenerate (line 111, external)
    -> res.redirect (line 119, external)
    -> req.get (line 119, external)
    -> res.redirect (line 125, external)
    -> app.listen (line 132, external)
    -> console.log (line 133, external)
  authenticate:
    -> console.log (line 61, external)
    -> fn (line 64, external)
    -> hash (line 68, external)
    -> fn (line 69, external)
    -> fn (line 70, external)
    -> fn (line 71, external)
  restrict:
    -> next (line 77, external)
    -> res.redirect (line 80, external)
```


## /tmp/test-js-express/examples/content-negotiation/index.js
```
Symbols:
  variable: express
  variable: app
  variable: users
  function: AnonymousFunctioned3add6d0100(req, res)
  function: AnonymousFunctioned3add6d0200()
  function: AnonymousFunctioned3add6d0300(user)
  function: AnonymousFunctioned3add6d0400()
  function: AnonymousFunctioned3add6d0500(user)
  function: AnonymousFunctioned3add6d0600()
  function: format(path)
    function: AnonymousFunctioned3add6d0700(req, res)

Calls:
  <module>:
    -> require (line 3, external)
    -> express (line 4, external)
    -> require (line 5, external)
    -> app.get (line 9, external)
    -> res.format (line 10, external)
    -> res.send (line 12, external)
    -> users.map(function(user){
        return '<li>' + user.name + '</li>';
      }).join (line 12, external)
    -> users.map (line 12, external)
    -> res.send (line 18, external)
    -> users.map(function(user){
        return ' - ' + user.name + '\n';
      }).join (line 18, external)
    -> users.map (line 18, external)
    -> res.json (line 24, external)
    -> app.get (line 40, external)
    -> format (line 40, external)
    -> app.listen (line 44, external)
    -> console.log (line 45, external)
  format:
    -> require (line 34, external)
    -> res.format (line 36, external)
```


## /tmp/test-js-express/examples/cookies/index.js
```
Symbols:
  variable: express
  variable: app
  variable: logger
  variable: cookieParser
  function: AnonymousFunctionb00430b10100(req, res)
  function: AnonymousFunctionb00430b10200(req, res)
  function: AnonymousFunctionb00430b10300(req, res)

Calls:
  <module>:
    -> require (line 7, external)
    -> express (line 8, external)
    -> require (line 9, external)
    -> require (line 10, external)
    -> app.use (line 13, external)
    -> logger (line 13, external)
    -> app.use (line 19, external)
    -> cookieParser (line 19, external)
    -> app.use (line 22, external)
    -> express.urlencoded (line 22, external)
    -> app.get (line 24, external)
    -> res.send (line 26, external)
    -> res.send (line 28, external)
    -> app.get (line 34, external)
    -> res.clearCookie (line 35, external)
    -> res.redirect (line 36, external)
    -> req.get (line 36, external)
    -> app.post (line 39, external)
    -> res.cookie (line 43, external)
    -> res.redirect (line 46, external)
    -> req.get (line 46, external)
    -> app.listen (line 51, external)
    -> console.log (line 52, external)
```


## /tmp/test-js-express/examples/error-pages/index.js
```
Symbols:
  variable: express
  variable: path
  variable: app
  variable: logger
  variable: silent
  function: AnonymousFunctionb8e3bc4b0100(req, res)
  function: AnonymousFunctionb8e3bc4b0200(req, res, next)
  function: AnonymousFunctionb8e3bc4b0300(req, res, next)
  function: AnonymousFunctionb8e3bc4b0400(req, res, next)
  function: AnonymousFunctionb8e3bc4b0500(req, res, next)
  function: AnonymousFunctionb8e3bc4b0600()
  function: AnonymousFunctionb8e3bc4b0700()
  function: AnonymousFunctionb8e3bc4b0800()
  function: AnonymousFunctionb8e3bc4b0900(err, req, res, next)

Calls:
  <module>:
    -> require (line 7, external)
    -> require (line 8, external)
    -> express (line 9, external)
    -> require (line 10, external)
    -> app.set (line 14, external)
    -> path.join (line 14, external)
    -> app.set (line 15, external)
    -> app.enable (line 20, external)
    -> app.disable (line 24, external)
    -> app.use (line 26, external)
    -> logger (line 26, external)
    -> app.get (line 30, external)
    -> res.render (line 31, external)
    -> app.get (line 34, external)
    -> next (line 38, external)
    -> app.get (line 41, external)
    -> Error (line 43, external)
    -> next (line 45, external)
    -> app.get (line 48, external)
    -> next (line 50, external)
    -> Error (line 50, external)
    -> app.use (line 63, external)
    -> res.status (line 64, external)
    -> res.format (line 66, external)
    -> res.render (line 68, external)
    -> res.json (line 71, external)
    -> res.type('txt').send (line 74, external)
    -> res.type (line 74, external)
    -> app.use (line 91, external)
    -> res.status (line 95, external)
    -> res.render (line 96, external)
    -> app.listen (line 101, external)
    -> console.log (line 102, external)
```


## /tmp/test-js-express/examples/error/index.js
```
Symbols:
  variable: express
  variable: logger
  variable: app
  variable: test
  function: error(err, req, res, next)
  function: AnonymousFunctionc37c358e0100()
  function: AnonymousFunctionc37c358e0200(req, res, next)
  function: AnonymousFunctionc37c358e0300()

Calls:
  <module>:
    -> require (line 7, external)
    -> require (line 8, external)
    -> express (line 9, external)
    -> app.get (line 10, external)
    -> app.use (line 12, external)
    -> logger (line 12, external)
    -> app.get (line 29, external)
    -> Error (line 31, external)
    -> app.get (line 34, external)
    -> process.nextTick (line 39, external)
    -> next (line 40, external)
    -> Error (line 40, external)
    -> app.use (line 47, external)
    -> app.listen (line 51, external)
    -> console.log (line 52, external)
  error:
    -> console.error (line 22, external)
    -> res.status (line 25, external)
    -> res.send (line 26, external)
```


## /tmp/test-js-express/examples/markdown/index.js
```
Symbols:
  variable: escapeHtml
  variable: express
  variable: fs
  variable: marked
  variable: path
  variable: app
  function: AnonymousFunction19748b070100(path, options, fn)
  function: AnonymousFunction19748b070200(err, str)
    function: AnonymousFunction19748b070300(_, name)
  function: AnonymousFunction19748b070400(req, res)
  function: AnonymousFunction19748b070500(req, res)

Calls:
  <module>:
    -> require (line 7, external)
    -> require (line 8, external)
    -> require (line 9, external)
    -> require (line 10, external)
    -> require (line 11, external)
    -> express (line 13, external)
    -> app.engine (line 17, external)
    -> fs.readFile (line 18, external)
    -> fn (line 19, external)
    -> marked.parse(str).replace (line 20, external)
    -> marked.parse (line 20, external)
    -> escapeHtml (line 21, external)
    -> fn (line 23, external)
    -> app.set (line 27, external)
    -> path.join (line 27, external)
    -> app.set (line 30, external)
    -> app.get (line 32, external)
    -> res.render (line 33, external)
    -> app.get (line 36, external)
    -> res.render (line 37, external)
    -> app.listen (line 42, external)
    -> console.log (line 43, external)
```


## /tmp/test-js-express/examples/mvc/index.js
```
Symbols:
  variable: express
  variable: logger
  variable: path
  variable: session
  variable: methodOverride
  variable: app
  function: AnonymousFunction070e720a0100(req, res, next)
  function: AnonymousFunction070e720a0200(err, req, res, next)
  function: AnonymousFunction070e720a0300(req, res, next)

Calls:
  <module>:
    -> require (line 7, external)
    -> require (line 8, external)
    -> require (line 9, external)
    -> require (line 10, external)
    -> require (line 11, external)
    -> express (line 13, external)
    -> app.set (line 17, external)
    -> app.set (line 20, external)
    -> path.join (line 20, external)
    -> sess.messages.push (line 29, external)
    -> app.use (line 34, external)
    -> logger (line 34, external)
    -> app.use (line 37, external)
    -> express.static (line 37, external)
    -> path.join (line 37, external)
    -> app.use (line 40, external)
    -> session (line 40, external)
    -> app.use (line 47, external)
    -> express.urlencoded (line 47, external)
    -> app.use (line 50, external)
    -> methodOverride (line 50, external)
    -> app.use (line 53, external)
    -> next (line 69, external)
    -> require (line 76, external)
    -> app.use (line 78, external)
    -> console.error (line 80, external)
    -> res.status(500).render (line 83, external)
    -> res.status (line 83, external)
    -> app.use (line 87, external)
    -> res.status(404).render (line 88, external)
    -> res.status (line 88, external)
    -> app.listen (line 93, external)
    -> console.log (line 94, external)
```


## /tmp/test-js-express/examples/online/index.js
```
Symbols:
  variable: express
  variable: online
  variable: redis
  variable: db
  variable: app
  function: AnonymousFunction666bdfc90100(req, res, next)
  function: list(ids)
  function: AnonymousFunction666bdfc90200(id)
  function: AnonymousFunction666bdfc90300(req, res, next)
  function: AnonymousFunction666bdfc90400(err, ids)

Calls:
  <module>:
    -> require (line 14, external)
    -> require (line 15, external)
    -> require (line 16, external)
    -> redis.createClient (line 17, external)
    -> online (line 21, external)
    -> express (line 25, external)
    -> app.use (line 30, external)
    -> online.add (line 32, external)
    -> next (line 33, external)
    -> app.get (line 50, external)
    -> online.last (line 51, external)
    -> next (line 52, external)
    -> res.send (line 53, external)
    -> list (line 53, external)
    -> app.listen (line 59, external)
    -> console.log (line 60, external)
  list:
    -> ids.map(function(id){
    return '<li>' + id + '</li>';
  }).join (line 41, external)
    -> ids.map (line 41, external)
```


## /tmp/test-js-express/examples/params/index.js
```
Symbols:
  variable: createError
  variable: express
  variable: app
  variable: users
  function: AnonymousFunction0f46e8e80100(req, res, next, num, name)
  function: AnonymousFunction0f46e8e80200(req, res, next, id)
  function: AnonymousFunction0f46e8e80300(req, res)
  function: AnonymousFunction0f46e8e80400(req, res)
  function: AnonymousFunction0f46e8e80500(req, res)
    function: AnonymousFunction0f46e8e80600(user)

Calls:
  <module>:
    -> require (line 7, external)
    -> require (line 8, external)
    -> express (line 9, external)
    -> app.param (line 23, external)
    -> parseInt (line 24, external)
    -> isNaN (line 25, external)
    -> next (line 26, external)
    -> createError (line 26, external)
    -> next (line 28, external)
    -> app.param (line 34, external)
    -> next (line 37, external)
    -> next (line 39, external)
    -> createError (line 39, external)
    -> app.get (line 47, external)
    -> res.send (line 48, external)
    -> app.get (line 55, external)
    -> res.send (line 56, external)
    -> app.get (line 63, external)
    -> users.map (line 66, external)
    -> res.send (line 67, external)
    -> names.slice(from, to + 1).join (line 67, external)
    -> names.slice (line 67, external)
    -> app.listen (line 72, external)
    -> console.log (line 73, external)
```


## /tmp/test-js-express/examples/resource/index.js
```
Symbols:
  variable: express
  variable: app
    class: resource(path, obj)
  variable: users
  class: User
    method: index(req, res)
    method: show(req, res)
    method: destroy(req, res, id)
    method: range(req, res, a, b, format)
  function: AnonymousFunction015f574c0400(req, res)

Calls:
  <module>:
    -> require (line 7, external)
    -> express (line 9, external)
    -> this.get (line 14, external)
    -> this.get (line 15, external)
    -> parseInt (line 16, external)
    -> parseInt (line 17, external)
    -> obj.range (line 19, external)
    -> this.get (line 21, external)
    -> this.delete (line 22, external)
    -> parseInt (line 23, external)
    -> obj.destroy (line 24, external)
    -> res.send (line 43, external)
    -> res.send (line 46, external)
    -> res.send (line 51, external)
    -> users.slice (line 54, external)
    -> res.send (line 57, external)
    -> range.map(function(user){
          return '<li>' + user.name + '</li>';
        }).join (line 61, external)
    -> range.map (line 61, external)
    -> res.send (line 64, external)
    -> app.resource (line 76, external)
    -> app.get (line 78, external)
    -> res.send (line 79, external)
    -> [
    '<h1>Examples:</h1> <ul>'
    , '<li>GET /users</li>'
    , '<li>GET /users/1</li>'
    , '<li>GET /users/3</li>'
    , '<li>GET /users/1..3</li>'
    , '<li>GET /users/1..3.json</li>'
    , '<li>DELETE /users/4</li>'
    , '</ul>'
  ].join (line 79, external)
    -> app.listen (line 93, external)
    -> console.log (line 94, external)
```
