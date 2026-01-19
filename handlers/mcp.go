package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"
)

// MCPServerConfig represents a single MCP server configuration
type MCPServerConfig struct {
	Type    string            `json:"type"` // "http" or "stdio"
	URL     string            `json:"url,omitempty"`
	Command string            `json:"command,omitempty"`
	Args    []string          `json:"args,omitempty"`
	Env     map[string]string `json:"env,omitempty"`
	Source  string            `json:"source"` // "user" or "project"
}

// MCPConfigFile represents the structure of mcp.json files
type MCPConfigFile struct {
	MCPServers map[string]MCPServerConfigRaw `json:"mcpServers"`
}

// ClaudeConfigFile represents the structure of ~/.claude.json
type ClaudeConfigFile struct {
	MCPServers map[string]MCPServerConfigRaw `json:"mcpServers"`
}

// MCPServerConfigRaw represents the raw server config from JSON (without Source)
type MCPServerConfigRaw struct {
	Type    string            `json:"type"`
	URL     string            `json:"url,omitempty"`
	Command string            `json:"command,omitempty"`
	Args    []string          `json:"args,omitempty"`
	Env     map[string]string `json:"env,omitempty"`
}

// MCPServer represents a named MCP server with its configuration
type MCPServer struct {
	Name   string          `json:"name"`
	Config MCPServerConfig `json:"config"`
}

// loadMCPConfig loads and parses an MCP configuration file
func loadMCPConfig(path string, source string) ([]MCPServer, error) {
	var servers []MCPServer

	data, err := os.ReadFile(path)
	if err != nil {
		return servers, err
	}

	var configFile MCPConfigFile
	if err := json.Unmarshal(data, &configFile); err != nil {
		return servers, err
	}

	for name, rawConfig := range configFile.MCPServers {
		server := MCPServer{
			Name: name,
			Config: MCPServerConfig{
				Type:    rawConfig.Type,
				URL:     rawConfig.URL,
				Command: rawConfig.Command,
				Args:    rawConfig.Args,
				Env:     rawConfig.Env,
				Source:  source,
			},
		}
		servers = append(servers, server)
	}

	return servers, nil
}

// loadClaudeConfig loads MCP servers from ~/.claude.json
func loadClaudeConfig(path string, source string) ([]MCPServer, error) {
	var servers []MCPServer

	data, err := os.ReadFile(path)
	if err != nil {
		return servers, err
	}

	var configFile ClaudeConfigFile
	if err := json.Unmarshal(data, &configFile); err != nil {
		return servers, err
	}

	for name, rawConfig := range configFile.MCPServers {
		server := MCPServer{
			Name: name,
			Config: MCPServerConfig{
				Type:    rawConfig.Type,
				URL:     rawConfig.URL,
				Command: rawConfig.Command,
				Args:    rawConfig.Args,
				Env:     rawConfig.Env,
				Source:  source,
			},
		}
		servers = append(servers, server)
	}

	return servers, nil
}

// GetMCPServers returns all MCP server configurations from user and project locations
func GetMCPServers(c *gin.Context) {
	workDir := c.Query("work_dir")
	if workDir == "" {
		workDir = "."
	}

	var allServers []MCPServer
	homeDir, _ := os.UserHomeDir()

	// 1. User config from ~/.claude.json (root level mcpServers)
	claudeConfigPath := filepath.Join(homeDir, ".claude.json")
	if userServers, err := loadClaudeConfig(claudeConfigPath, "user"); err == nil {
		allServers = append(allServers, userServers...)
	}

	// 2. Legacy user config: ~/.claude/mcp.json (if exists)
	legacyUserConfigPath := filepath.Join(homeDir, ".claude", "mcp.json")
	if userServers, err := loadMCPConfig(legacyUserConfigPath, "user"); err == nil {
		allServers = append(allServers, userServers...)
	}

	// 3. Project config: {work_dir}/.mcp.json
	projectConfigPath := filepath.Join(workDir, ".mcp.json")
	if projectServers, err := loadMCPConfig(projectConfigPath, "project"); err == nil {
		allServers = append(allServers, projectServers...)
	}

	c.JSON(http.StatusOK, gin.H{
		"servers": allServers,
	})
}
