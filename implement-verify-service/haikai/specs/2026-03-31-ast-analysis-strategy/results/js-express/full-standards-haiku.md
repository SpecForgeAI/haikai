# Coding Standards for JavaScript/Express.js Codebase

## Executive Summary

This codebase comprises **100 JavaScript files** organized primarily as an Express.js framework demonstration with test suites. The analysis reveals **high inter-module coupling** (7,542 call edges), heavy reliance on **callback-based async patterns**, and **inconsistent separation of concerns**. This document synthesizes structural findings with per-file LLM interpretations to establish cohesive coding standards.

---

## Structural Overview

| Metric | Value |
|--------|-------|
| **Files Analyzed** | 100 |
| **Total Functions** | 1,881 |
| **Total Classes** | 141 |
| **Total Variables** | 349 |
| **Total Call Edges** | 7,542 |
| **Complex Files** | 71 |
| **Trivial Files** | 29 |

### Call Graph Hotspots (Top 15)

| Target | Call Count |
|--------|----------:|
| `it` (test runner) | 709 |
| `request` (HTTP testing) | 603 |
| `describe` (test suite) | 327 |
| `express` (framework) | 307 |
| `require` (module loading) | 287 |
| `request(app).get` | 260 |
| `next` (middleware) | 198 |
| `app.use` (middleware registration) | 197 |
| `app.get` (route definition) | 171 |
| `createApp` (app factory) | 159 |
| `test.set` | 145 |
| `res.send` (response) | 136 |
| `done` (test completion) | 121 |
| `request(this.app).post` | 117 |
| `test.write` | 107 |

---

## Naming Conventions

### Variables

**Standard: Lowercase camelCase**

- **Module imports:** `express`, `path`, `fs`, `morgan`, `cookieParser`
- **App instances:** `app` (singular, lowercase)
- **Local variables:** `users`, `logger`, `config` (camelCase for multi-word identifiers)
- **Constants:** Use UPPER_SNAKE_CASE (e.g., `DEFAULT_PORT = 3000`)

**Exceptions:**
- Do not use underscore-prefixed names for "private" properties (JavaScript convention is to document in JSDoc)
- Avoid single-letter variables outside of loop counters (`i`, `j`, `k`)

---

### Functions

**Standard: Named functions for reusable middleware; anonymous callbacks acceptable for route handlers**

#### Named Functions (Required)
- Middleware that can be composed or reused
- Utility/helper functions
- Error handlers
- Parameter validators

**Example:**
```javascript
// ✓ GOOD
const authenticate = (req, res, next) => {
  // validation logic
  next();
};

app.use(authenticate);

// ✓ GOOD
const errorHandler = (err, req, res, next) => {
  res.status(500).send('Error');
};
app.use(errorHandler);
```

#### Anonymous Functions (Acceptable)
- Route handlers with trivial logic (single res.send/render call)
- Short callbacks with clear parameter semantics

**Example:**
```javascript
// ✓ ACCEPTABLE for simple routes
app.get('/', (req, res) => {
  res.send('Hello World');
});

// ✗ UNACCEPTABLE for complex logic
app.get('/complex', (req, res) => {
  // 50+ lines of business logic
  // should be extracted to named handler
});
```

**For test files:**
- Use descriptive strings in `describe()` and `it()` blocks instead of relying on function names
- Anonymous callbacks in test suites are standard and acceptable

---

### Classes

**Standard: PascalCase for all class definitions**

**Violations Detected:**
- `users` class (should be `Users`)
- `tj` nested class (should be `TJ`)

**Example:**
```javascript
// ✓ GOOD
class AuthService {
  authenticate(credentials) { }
}

// ✗ BAD
class authService {
  authenticate(credentials) { }
}
```

---

### Parameters

**Standard: Express.js middleware signature convention**

```javascript
// Middleware
(req, res, next)

// Error middleware (4 parameters required)
(err, req, res, next)

// Parameter validators
app.param('id', (req, res, next, id, paramName) => {
  // validation logic
  next();
});
```

---

## Architectural Patterns

### Middleware Composition

**Standard: Use composable, independently testable middleware**

**Execution Order (Required):**
1. Logging middleware (global request/response tracking)
2. Body parsing middleware (JSON, form data, etc.)
3. Session/authentication middleware
4. Route-specific middleware
5. Error handling middleware (last)

**Example:**
```javascript
// ✓ GOOD - clear separation
app.use(logger);              // 1. Logging
app.use(express.json());      // 2. Parsing
app.use(session());           // 3. Session
app.use('/api', authCheck);   // 4. Route-specific
app.use(errorHandler);        // 5. Error handling
```

**Properties:**
- Middleware must follow `(req, res, next) => {}` signature
- All async operations must use callbacks or Promises
- Errors must be propagated via `next(error)` or thrown (for Promise-based middleware)

---

### Route Organization

**Standard: Separate concerns—do not mix business logic with HTTP handling**

#### Anti-Pattern (High Coupling)
```javascript
// ✗ BAD - business logic in route handler
app.post('/users', (req, res) => {
  const user = new User(req.body);
  user.validate();
  user.hashPassword();
  user.save();
  res.json(user);
});
```

#### Recommended Pattern (Low Coupling)
```javascript
// ✓ GOOD - separated concerns
const userController = {
  create: (req, res, next) => {
    userService.createUser(req.body)
      .then(user => res.json(user))
      .catch(next);  // Pass errors to middleware
  }
};

app.post('/users', userController.create);
```

**Requirements:**
- Route handlers should focus on HTTP concerns (request/response)
- Business logic should be extracted to service/controller modules
- Data access should use repository or DAO pattern
- Never hardcode test data in route handlers

---

### Error Handling

**Standard: Centralized error handling with middleware**

#### Required Components

1. **Error Middleware (4-parameter function)**
   ```javascript
   app.use((err, req, res, next) => {
     const status = err.statusCode || 500;
     const message = err.message || 'Internal Server Error';
     res.status(status).json({ error: message });
   });
   ```

2. **Error Propagation in Handlers**
   ```javascript
   // Callbacks
   someAsync((err, result) => {
     if (err) return next(err);  // Pass to error middleware
     res.json(result);
   });

   // Promises
   somePromise()
     .catch(next);  // Pass errors to error middleware
   ```

3. **Error Creation**
   - Use `http-errors` or similar library
   - Include meaningful status codes and messages
   ```javascript
   const createError = require('http-errors');
   
   // ✓ GOOD
   throw createError(404, 'User not found');
   
   // ✗ BAD
   res.send('Not found');
   ```

#### Missing Patterns (Add to Standards)

- **No try-catch blocks** visible in current codebase
- **No logging framework** (only console.log detected)
- **No request context** in error logs

**Action Items:**
- Implement structured logging (winston, pino, bunyan)
- Add request ID tracking for error correlation
- Document all error types and expected HTTP responses

---

### Authentication & Authorization

**Standard: Separate authentication logic from routing**

#### Recommended Pattern

```javascript
// auth/service.js - Separate module
const authenticate = (credentials) => {
  // Validate, hash, verify
};

// middleware/auth.js - Middleware
const authMiddleware = (req, res, next) => {
  authenticate(req.body)
    .then(user => {
      req.user = user;
      next();
    })
    .catch(err => next(err));
};

// routes/auth.js
app.post('/login', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});
```

**Requirements:**
- Authentication logic should not be embedded in route handlers
- Use session regeneration after successful login
- Implement password hashing (bcrypt, argon2)
- Separate public and protected routes clearly

---

### Data Access

**Standard: Abstract data persistence behind service/repository layer**

#### Anti-Pattern
```javascript
// ✗ BAD - hardcoded data in route handler
const users = [{ id: 1, name: 'Alice' }];

app.get('/users/:id', (req, res) => {
  const user = users.find(u => u.id === parseInt(req.params.id));
  res.json(user);
});
```

#### Recommended Pattern
```javascript
// ✓ GOOD - service abstraction
// services/userService.js
const getUserById = (id) => {
  // Database query, caching, validation
};

// routes/users.js
app.get('/users/:id', (req, res, next) => {
  userService.getUserById(req.params.id)
    .then(user => res.json(user))
    .catch(next);
});
```

**Requirements:**
- Never hardcode test/seed data in implementation files
- Use dependency injection for database clients
- Implement repository pattern for data access
- Validate and transform data at service layer

---

### Parameter Validation

**Standard: Validate all route parameters and request bodies**

#### For Route Parameters
```javascript
// ✓ GOOD - using app.param
app.param('id', (req, res, next, id) => {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    return next(createError(400, 'Invalid ID'));
  }
  req.params.id = numId;
  next();
});
```

#### For Request Bodies
```javascript
// ✓ GOOD - middleware validation
const validateUser = (req, res, next) => {
  if (!req.body.email || !req.body.password) {
    return next(createError(400, 'Missing fields'));
  }
  next();
};

app.post('/users', validateUser, (req, res, next) => {
  userService.create(req.body)
    .then(user => res.status(201).json(user))
    .catch(next);
});
```

**Requirements:**
- Never use parseInt/parseFloat without validation
- Check for NaN and null/undefined values
- Consider schema validation (joi, yup, zod)
- Return 400 status for validation errors
- Validate content-type headers for POST/PUT requests

---

## Dependency Management

### Coupling Assessment

**Current State: HIGH (7,542 call edges)**

| Coupling Type | Level | Concern |
|---------------|-------|---------|
| **Express.js API** | HIGH | Direct calls to `app.get`, `app.use`, `res.send` throughout |
| **Middleware composition** | HIGH | Tightly bound execution order; hard to reuse |
| **Data access** | HIGH | Hardcoded arrays, direct database calls in handlers |
| **Error handling** | MEDIUM | Inconsistent patterns; callback vs. Promise mixing |
| **Testing** | LOW | Anonymous functions impair mock injection |

### Recommended Patterns

#### Dependency Injection
```javascript
// ✓ GOOD - injected dependencies
const createUserHandler = (userService) => {
  return (req, res, next) => {
    userService.create(req.body)
      .then(user => res.json(user))
      .catch(next);
  };
};

module.exports = createUserHandler;

// In app.js
const userService = require('./services/userService');
const userHandler = createUserHandler(userService);
app.post('/users', userHandler);
```

#### Module Organization
```
project/
├── lib/
│   ├── application.js        # Express app factory
│   ├── request.js            # Request utilities
│   ├── response.js           # Response utilities
│   └── router.js             # Router configuration
├── routes/
│   ├── users.js              # User routes
│   └── auth.js               # Auth routes
├── middleware/
│   ├── auth.js               # Auth middleware
│   ├── validation.js         # Validation middleware
│   └── errorHandler.js       # Error handling
├── services/
│   ├── userService.js        # Business logic
│   └── authService.js        # Auth logic
├── models/ or data/
│   └── userRepository.js     # Data access
└── app.js                    # Entry point
```

---

## Test Structure

### Test File Organization

**Standard: Mimic source file structure**

```
test/
├── acceptance/               # Integration/E2E tests
│   ├── auth.js
│   ├── users.js
│   └── error-pages.js
├── unit/                     # Unit tests (if applicable)
│   ├── services/
│   └── middleware/
└── fixtures/                 # Test data
    └── users.json
```

### Test Writing Patterns

**Standard: Use descriptive test suites and cases**

```javascript
// ✓ GOOD
describe('GET /users/:id', () => {
  it('returns user when ID is valid', (done) => {
    request(app)
      .get('/users/1')
      .expect(200)
      .expect({ id: 1, name: 'Alice' })
      .end(done);
  });

  it('returns 400 when ID is invalid', (done) => {
    request(app)
      .get('/users/invalid')
      .expect(400)
      .end(done);
  });
});

// ✗ BAD
describe('Users', () => {
  it('works', (done) => {
    request(app).get('/users/1').end(done);
  });
});
```

**Requirements:**
- Use `describe()` for logical grouping (by route, feature, or module)
- Use `it()` with clear, behavior-focused descriptions
- Test both success and error cases
- Use `done` callback or Promises
- Test middleware/error handlers explicitly

---

## Code Organization Concerns

### Separation of Concerns (Critical)

**Current Violations Detected:**
- Business logic mixed with route handlers
- Test data embedded in implementation files
- Authentication logic tightly coupled to routing
- No controller/service abstraction

**Standards to Enforce:**

| Layer | Responsibility | Example File |
|-------|-----------------|--------------|
| **Routes** | HTTP routing only | `routes/users.js` |
| **Controllers** | Request/response handling | `controllers/userController.js` |
| **Services** | Business logic | `services/userService.js` |
| **Repositories** | Data access | `data/userRepository.js` |
| **Middleware** | Cross-cutting concerns | `middleware/auth.js` |
| **Models** | Data structures | `models/User.js` |

**Example Refactoring:**

Before (Coupled):
```javascript
app.get('/users/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).send('Invalid');
  const user = users.find(u => u.id === id);
  if (!user) return res.status(404).send('Not found');
  res.json(user);
});
```

After (Separated):
```javascript
// routes/users.js
app.get('/users/:id', 
  validateId,                    // Middleware
  userController.getById         // Handler
);

// middleware/validateId.js
const validateId = (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return next(