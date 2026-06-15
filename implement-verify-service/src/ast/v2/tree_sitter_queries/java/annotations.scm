; Capture HTTP-verb annotations on class and method declarations.
; Used by spring-boot and jax-rs playbooks (T2.2).

; Method-level annotation with arguments: @GetMapping("/users")
(method_declaration
  (modifiers
    (annotation
      name: (identifier) @ann.name
      arguments: (annotation_argument_list) @ann.args) @ann)
  name: (identifier) @method.name) @method

; Method-level marker annotation (no args): @GET
(method_declaration
  (modifiers
    (marker_annotation
      name: (identifier) @ann.name) @ann)
  name: (identifier) @method.name) @method

; Class-level annotation with arguments: @RequestMapping("/api"), @Path("/users")
(class_declaration
  (modifiers
    (annotation
      name: (identifier) @ann.name
      arguments: (annotation_argument_list) @ann.args) @ann)
  name: (identifier) @class.name) @class

; Class-level marker annotation
(class_declaration
  (modifiers
    (marker_annotation
      name: (identifier) @ann.name) @ann)
  name: (identifier) @class.name) @class

; Also applies to interfaces (JAX-RS uses @Path on interfaces sometimes)
(interface_declaration
  (modifiers
    (annotation
      name: (identifier) @ann.name
      arguments: (annotation_argument_list) @ann.args) @ann)
  name: (identifier) @class.name) @class
