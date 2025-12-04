package config

import (
	"database/sql"
	"log"
	"os"
	
	_ "github.com/mattn/go-sqlite3"
)

const (
	DatabasePath = "./data/androidcontrol.db"
	MigrationsPath = "./scripts/migrations.sql"
)

// InitDatabase initializes the SQLite database
func InitDatabase() (*sql.DB, error) {
	// Create data directory if not exists
	if err := os.MkdirAll("./data", 0755); err != nil {
		return nil, err
	}

	// Open database
	db, err := sql.Open("sqlite3", DatabasePath)
	if err != nil {
		return nil, err
	}

	// Test connection
	if err := db.Ping(); err != nil {
		return nil, err
	}

	// Run migrations
	if err := runMigrations(db); err != nil {
		return nil, err
	}

	log.Println("Database initialized successfully")
	return db, nil
}

func runMigrations(db *sql.DB) error {
	// Read migration file
	migrations, err := os.ReadFile(MigrationsPath)
	if err != nil {
		return err
	}

	// Execute migrations
	_, err = db.Exec(string(migrations))
	return err
}
