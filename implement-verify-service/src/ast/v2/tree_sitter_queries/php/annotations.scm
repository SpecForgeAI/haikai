; Capture PHP doc-comment annotations (T2.7).
; Doctrine / Symfony 4.x: /** @Route("/users") */ above a method.
;
; NOTE: tree-sitter-php captures doc comments as `comment` tokens. The actual
; @Route(...) parsing happens downstream in Python (annotations.py). This .scm
; only surfaces (comment, method) or (comment, class) pairs.

; Doc comment immediately preceding a method declaration
(method_declaration
  (visibility_modifier)? @visibility
  (function_definition
    name: (name) @method.name)?
  name: (name)? @method.name) @method

; A leading comment (the doc comment) can be the sibling preceding the
; method in the class body. Authors query for "comments attached to methods"
; by walking the preceding-sibling chain in Python, since tree-sitter does
; not attach comments as children of method_declaration.
(comment) @doc.comment
