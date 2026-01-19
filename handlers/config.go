package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
)

// Command represents a command definition with metadata
type Command struct {
	Name         string `json:"name"`
	Description  string `json:"description,omitempty"`
	ArgumentHint string `json:"argumentHint,omitempty"`
	Source       string `json:"source"` // "global", "project", or plugin namespace
}

// Config represents a CLAUDE.md configuration file
type Config struct {
	Type    string `json:"type"`    // "global", "project", or "root"
	Path    string `json:"path"`    // Full file path
	Content string `json:"content"` // File contents
}

// Plugin represents an installed plugin with its assets
type Plugin struct {
	Name     string   `json:"name"`
	Version  string   `json:"version"`
	Path     string   `json:"path"`
	Enabled  bool     `json:"enabled"`
	Commands []string `json:"commands"`
	Agents   []string `json:"agents"`
	Skills   []string `json:"skills"`
}

// InstalledPluginEntry represents a single plugin installation entry
type InstalledPluginEntry struct {
	Scope        string `json:"scope"`
	InstallPath  string `json:"installPath"`
	Version      string `json:"version"`
	InstalledAt  string `json:"installedAt"`
	LastUpdated  string `json:"lastUpdated"`
	GitCommitSha string `json:"gitCommitSha"`
}

// InstalledPluginsFile represents the installed_plugins.json structure (v2)
type InstalledPluginsFile struct {
	Version int                               `json:"version"`
	Plugins map[string][]InstalledPluginEntry `json:"plugins"`
}

// parseFrontmatter extracts metadata from markdown frontmatter
func parseFrontmatter(content string) (description string, argumentHint string) {
	lines := strings.Split(content, "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != "---" {
		return "", ""
	}

	inFrontmatter := true
	for i := 1; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])
		if line == "---" {
			break
		}
		if !inFrontmatter {
			continue
		}

		if strings.HasPrefix(line, "description:") {
			desc := strings.TrimPrefix(line, "description:")
			desc = strings.TrimSpace(desc)
			desc = strings.Trim(desc, `"'`)
			description = desc
		} else if strings.HasPrefix(line, "argument-hint:") {
			hint := strings.TrimPrefix(line, "argument-hint:")
			hint = strings.TrimSpace(hint)
			hint = strings.Trim(hint, `"'`)
			argumentHint = hint
		}
	}

	return description, argumentHint
}

// scanCommandsInDir scans a directory for *.md and */skill.md files
func scanCommandsInDir(dir string, source string) []Command {
	var commands []Command

	// Check if directory exists
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return commands
	}

	// Scan for *.md files in directory
	entries, err := os.ReadDir(dir)
	if err != nil {
		return commands
	}

	for _, entry := range entries {
		if entry.IsDir() {
			// Check for skill.md in subdirectory
			skillPath := filepath.Join(dir, entry.Name(), "skill.md")
			if content, err := os.ReadFile(skillPath); err == nil {
				desc, argHint := parseFrontmatter(string(content))
				commands = append(commands, Command{
					Name:         entry.Name(),
					Description:  desc,
					ArgumentHint: argHint,
					Source:       source,
				})
			}
		} else if strings.HasSuffix(entry.Name(), ".md") && entry.Name() != "skill.md" {
			// Regular .md file (not skill.md)
			filePath := filepath.Join(dir, entry.Name())
			if content, err := os.ReadFile(filePath); err == nil {
				desc, argHint := parseFrontmatter(string(content))
				name := strings.TrimSuffix(entry.Name(), ".md")
				commands = append(commands, Command{
					Name:         name,
					Description:  desc,
					ArgumentHint: argHint,
					Source:       source,
				})
			}
		}
	}

	return commands
}

// ListCommands returns all available commands from global, project, and plugin sources
func ListCommands(c *gin.Context) {
	workDir := c.Query("work_dir")
	if workDir == "" {
		workDir = "."
	}

	var allCommands []Command
	homeDir, _ := os.UserHomeDir()

	// 1. Global commands: ~/.claude/commands/
	globalCommandsDir := filepath.Join(homeDir, ".claude", "commands")
	allCommands = append(allCommands, scanCommandsInDir(globalCommandsDir, "global")...)

	// 2. Project commands: {work_dir}/.claude/commands/
	projectCommandsDir := filepath.Join(workDir, ".claude", "commands")
	allCommands = append(allCommands, scanCommandsInDir(projectCommandsDir, "project")...)

	// 3. Plugin commands: from installed_plugins.json
	pluginsFile := filepath.Join(homeDir, ".claude", "plugins", "installed_plugins.json")
	if data, err := os.ReadFile(pluginsFile); err == nil {
		var pluginsData InstalledPluginsFile
		if err := json.Unmarshal(data, &pluginsData); err == nil {
			for pluginName, entries := range pluginsData.Plugins {
				if len(entries) == 0 {
					continue
				}
				entry := entries[0]

				commandsDir := filepath.Join(entry.InstallPath, "commands")
				pluginCommands := scanCommandsInDir(commandsDir, pluginName)

				// Prefix plugin commands with namespace:name
				for i := range pluginCommands {
					pluginCommands[i].Name = pluginName + ":" + pluginCommands[i].Name
				}

				allCommands = append(allCommands, pluginCommands...)
			}
		}
	}

	// Sort by name
	sort.Slice(allCommands, func(i, j int) bool {
		return allCommands[i].Name < allCommands[j].Name
	})

	c.JSON(http.StatusOK, gin.H{
		"commands": allCommands,
	})
}

// GetConfig returns CLAUDE.md configurations from global, project, and root locations
func GetConfig(c *gin.Context) {
	workDir := c.Query("work_dir")
	if workDir == "" {
		workDir = "."
	}

	var configs []Config
	homeDir, _ := os.UserHomeDir()

	// 1. Global: ~/.claude/CLAUDE.md
	globalPath := filepath.Join(homeDir, ".claude", "CLAUDE.md")
	if content, err := os.ReadFile(globalPath); err == nil {
		configs = append(configs, Config{
			Type:    "global",
			Path:    globalPath,
			Content: string(content),
		})
	}

	// 2. Project: {work_dir}/.claude/CLAUDE.md
	projectPath := filepath.Join(workDir, ".claude", "CLAUDE.md")
	if content, err := os.ReadFile(projectPath); err == nil {
		configs = append(configs, Config{
			Type:    "project",
			Path:    projectPath,
			Content: string(content),
		})
	}

	// 3. Root: {work_dir}/CLAUDE.md
	rootPath := filepath.Join(workDir, "CLAUDE.md")
	if content, err := os.ReadFile(rootPath); err == nil {
		configs = append(configs, Config{
			Type:    "root",
			Path:    rootPath,
			Content: string(content),
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"configs": configs,
	})
}

// scanAssetsInDir scans a directory and returns list of asset names (files and subdirs with skill.md)
func scanAssetsInDir(dir string) []string {
	var assets []string

	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return assets
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return assets
	}

	for _, entry := range entries {
		if entry.IsDir() {
			// Check if subdirectory has skill.md
			skillPath := filepath.Join(dir, entry.Name(), "skill.md")
			if _, err := os.Stat(skillPath); err == nil {
				assets = append(assets, entry.Name())
			}
		} else if strings.HasSuffix(entry.Name(), ".md") && entry.Name() != "skill.md" {
			name := strings.TrimSuffix(entry.Name(), ".md")
			assets = append(assets, name)
		}
	}

	sort.Strings(assets)
	return assets
}

// ListPlugins returns all installed plugins with their commands, agents, and skills
func ListPlugins(c *gin.Context) {
	homeDir, _ := os.UserHomeDir()
	pluginsFile := filepath.Join(homeDir, ".claude", "plugins", "installed_plugins.json")

	data, err := os.ReadFile(pluginsFile)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"plugins": []Plugin{},
		})
		return
	}

	var pluginsData InstalledPluginsFile
	if err := json.Unmarshal(data, &pluginsData); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to parse installed_plugins.json: " + err.Error(),
		})
		return
	}

	var plugins []Plugin
	for pluginName, entries := range pluginsData.Plugins {
		if len(entries) == 0 {
			continue
		}
		// Use the first (most recent) entry
		entry := entries[0]
		plugin := Plugin{
			Name:     pluginName,
			Version:  entry.Version,
			Path:     entry.InstallPath,
			Enabled:  true, // If it's in the file, it's enabled
			Commands: scanAssetsInDir(filepath.Join(entry.InstallPath, "commands")),
			Agents:   scanAssetsInDir(filepath.Join(entry.InstallPath, "agents")),
			Skills:   scanAssetsInDir(filepath.Join(entry.InstallPath, "skills")),
		}
		plugins = append(plugins, plugin)
	}

	c.JSON(http.StatusOK, gin.H{
		"plugins": plugins,
	})
}
