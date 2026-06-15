# Coding Style Standards

## Python Code Style

Follow PEP 8 guidelines for Python code with these specific requirements:

- Use 4 spaces for indentation (no tabs)
- Maximum line length of 100 characters
- Use snake_case for function and variable names
- Use PascalCase for class names
- Add docstrings to all public functions and classes

## Naming Conventions

- Functions should use verb phrases (e.g., `get_user`, `create_account`)
- Variables should use noun phrases (e.g., `user_email`, `password_hash`)
- Constants should use UPPER_SNAKE_CASE (e.g., `MAX_RETRIES`, `API_VERSION`)

## Code Organization

- Group imports in three sections: standard library, third-party, local
- Separate logical sections with blank lines
- Keep functions focused on a single responsibility
- Limit function length to 50 lines when possible
