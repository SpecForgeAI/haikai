// Sample Go file for tree-sitter extraction tests
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"sync"
)

// Database represents a database connection
type Database struct {
	conn   string
	mu     sync.Mutex
	logger *log.Logger
}

// NewDatabase creates a new Database instance
func NewDatabase(conn string) *Database {
	return &Database{
		conn:   conn,
		logger: log.Default(),
	}
}

// Query executes a query on the database
func (db *Database) Query(ctx context.Context, sql string) ([]map[string]interface{}, error) {
	db.mu.Lock()
	defer db.mu.Unlock()
	db.logger.Printf("Executing query: %s", sql)
	fmt.Println("query:", sql)
	return nil, nil
}

// Execute runs an insert/update/delete
func (db *Database) Execute(ctx context.Context, sql string, args ...interface{}) error {
	db.mu.Lock()
	defer db.mu.Unlock()
	return nil
}

// UserService handles user operations
type UserService struct {
	db     *Database
	cache  map[string]*User
}

// User represents a user record
type User struct {
	ID    string
	Name  string
	Email string
}

// NewUserService creates a new UserService
func NewUserService(db *Database) *UserService {
	return &UserService{
		db:    db,
		cache: make(map[string]*User),
	}
}

// FindByID retrieves a user by ID
func (s *UserService) FindByID(ctx context.Context, id string) (*User, error) {
	if cached, ok := s.cache[id]; ok {
		return cached, nil
	}
	results, err := s.db.Query(ctx, fmt.Sprintf("SELECT * FROM users WHERE id='%s'", id))
	if err != nil {
		return nil, fmt.Errorf("query failed: %w", err)
	}
	_ = results
	return &User{ID: id, Name: "test"}, nil
}

// Save persists a user
func (s *UserService) Save(ctx context.Context, user *User) error {
	err := s.db.Execute(ctx, "INSERT INTO users VALUES ($1, $2)", user.ID, user.Name)
	if err != nil {
		return fmt.Errorf("save failed: %w", err)
	}
	s.cache[user.ID] = user
	return nil
}

// StartServer launches the HTTP server with goroutines
func StartServer(svc *UserService) {
	http.HandleFunc("/users", func(w http.ResponseWriter, r *http.Request) {
		user, err := svc.FindByID(r.Context(), r.URL.Query().Get("id"))
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		fmt.Fprintf(w, "User: %s", user.Name)
	})

	go http.ListenAndServe(":8080", nil)
	go func() {
		fmt.Println("Background worker started")
		svc.FindByID(context.Background(), "healthcheck")
	}()
}

func main() {
	db := NewDatabase("postgres://localhost/test")
	svc := NewUserService(db)
	defer db.Execute(context.Background(), "CLEANUP")

	fmt.Println("Starting server...")
	StartServer(svc)
}
