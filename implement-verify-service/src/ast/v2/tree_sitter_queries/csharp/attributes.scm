; Capture C# attributes on classes and methods (T2.5).
; ASP.NET: [HttpGet("/users")], [Route("api/[controller]")]

; Class with attribute: [Route("api")] public class UsersController
(class_declaration
  (attribute_list
    (attribute
      name: [(identifier) (qualified_name)] @attr.name
      (attribute_argument_list)? @attr.args) @attr)
  name: (identifier) @class.name) @class

; Method with attribute: [HttpGet("{id}")] public IActionResult Get(int id)
(method_declaration
  (attribute_list
    (attribute
      name: [(identifier) (qualified_name)] @attr.name
      (attribute_argument_list)? @attr.args) @attr)
  name: (identifier) @method.name) @method
