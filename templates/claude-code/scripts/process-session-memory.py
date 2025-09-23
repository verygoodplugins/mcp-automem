#!/usr/bin/env python3
"""
AutoMem-Enhanced Session Memory Processor
Analyzes Claude Code session data with importance scoring, type classification,
and relationship creation for the new AutoMem service
"""

import json
import sys
import os
import re
import hashlib
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple

# Configuration for AutoMem integration
AUTOMEM_QUEUE_FILE = Path.home() / '.claude' / 'scripts' / 'memory-queue.jsonl'
STORAGE_AVAILABLE = False  # We'll queue for MCP processing

class SessionMemoryProcessor:
    """Processes Claude session data and stores significant memories"""
    
    def __init__(self):
        self.filters = self.load_filters()
        self.significance_threshold = 5  # Minimum score to store memory
    
    def load_filters(self) -> Dict[str, Any]:
        """Load filtering rules"""
        filters_path = Path.home() / ".claude" / "scripts" / "memory-filters.json"
        
        # Default filters if file doesn't exist
        default_filters = {
            "trivial_patterns": [
                r"^\s*$",  # Empty lines
                r"^#\s*$",  # Empty comments
                r"\.DS_Store",  # Mac system files
                r"__pycache__",  # Python cache
                r"node_modules",  # Node modules
                r"\.git/",  # Git internals
                r"\.venv/",  # Virtual environments
                r"venv/",  # Virtual environments
                r"\.pyc$",  # Python compiled files
            ],
            "significant_patterns": [
                r"feat[:\(]",  # Feature commits
                r"fix[:\(]",  # Bug fixes
                r"BREAKING",  # Breaking changes
                r"performance",  # Performance improvements
                r"security",  # Security updates
                r"refactor",  # Refactoring
                r"test[:\(]",  # Testing
            ],
            "file_weight": {
                ".py": 2.0,  # Python files
                ".js": 2.0,  # JavaScript
                ".ts": 2.0,  # TypeScript
                ".jsx": 2.0,  # React
                ".tsx": 2.0,  # React TypeScript
                ".php": 2.0,  # PHP
                ".go": 2.0,  # Go
                ".rs": 2.0,  # Rust
                ".java": 2.0,  # Java
                ".c": 2.0,  # C
                ".cpp": 2.0,  # C++
                ".sh": 1.5,  # Shell scripts
                ".yml": 1.5,  # YAML configs
                ".yaml": 1.5,  # YAML configs
                ".json": 1.3,  # JSON configs
                ".md": 1.2,  # Documentation
                ".txt": 0.8,  # Text files
            },
            "minimum_changes": 3,  # Minimum file changes for significance
            "minimum_lines": 10,  # Minimum lines changed
        }
        
        if filters_path.exists():
            try:
                with open(filters_path, 'r') as f:
                    return json.load(f)
            except Exception as e:
                print(f"Error loading filters: {e}")
        
        return default_filters
    
    def calculate_significance(self, session_data: Dict[str, Any]) -> Tuple[float, List[str]]:
        """Calculate significance score for session"""
        score = 0
        reasons = []
        
        # Parse session data
        file_changes = session_data.get('file_changes', '')
        recent_commits = session_data.get('recent_commits', '')
        diff_stats = session_data.get('diff_stats', '')
        staged_stats = session_data.get('staged_stats', '')
        
        # Count changed files
        if file_changes:
            changed_files = [f for f in file_changes.split('\n') if f.strip()]
            num_changes = len(changed_files)
            
            if num_changes >= self.filters['minimum_changes']:
                score += 2
                reasons.append(f"Modified {num_changes} files")
            
            # Check file types for importance
            for file_line in changed_files:
                if len(file_line) > 2:
                    filename = file_line[2:].strip()
                    for ext, weight in self.filters['file_weight'].items():
                        if filename.endswith(ext):
                            score += weight * 0.5
                            if weight >= 2.0:
                                reasons.append(f"Modified code file: {filename}")
                            break
        
        # Check for recent commits
        if recent_commits:
            commit_lines = recent_commits.split('\n')
            num_commits = len([c for c in commit_lines if c.strip()])
            
            if num_commits > 0:
                score += 3 * num_commits
                reasons.append(f"Made {num_commits} commits")
                
                # Check commit messages for significance
                for commit in commit_lines:
                    for pattern in self.filters['significant_patterns']:
                        if re.search(pattern, commit, re.IGNORECASE):
                            score += 2
                            reasons.append(f"Significant commit pattern: {pattern}")
                            break
        
        # Analyze diff statistics
        total_lines_changed = 0
        if diff_stats or staged_stats:
            stats_text = f"{diff_stats} {staged_stats}"
            
            # Extract line change numbers
            line_matches = re.findall(r'(\d+)\s+insertion', stats_text)
            for match in line_matches:
                total_lines_changed += int(match)
            
            line_matches = re.findall(r'(\d+)\s+deletion', stats_text)
            for match in line_matches:
                total_lines_changed += int(match)
            
            if total_lines_changed >= self.filters['minimum_lines']:
                score += min(5, total_lines_changed / 20)  # Cap at 5 points
                reasons.append(f"Changed {total_lines_changed} lines")
        
        # Check for specific keywords in project/branch names
        session_info = session_data.get('session_data', {})
        project_name = session_info.get('project_name', '').lower()
        git_branch = session_info.get('git_branch', '').lower()
        
        # Important project indicators
        important_keywords = ['production', 'release', 'hotfix', 'security', 'critical']
        for keyword in important_keywords:
            if keyword in project_name or keyword in git_branch:
                score += 3
                reasons.append(f"Important context: {keyword}")
                break
        
        # Feature branches get a boost
        if git_branch.startswith('feature/') or git_branch.startswith('fix/'):
            score += 1
            reasons.append(f"Feature/fix branch: {git_branch}")
        
        return score, reasons
    
    def extract_patterns(self, session_data: Dict[str, Any]) -> Dict[str, Any]:
        """Extract patterns and insights from session"""
        patterns = {
            'commit_style': None,
            'work_focus': [],
            'file_types': [],
            'change_size': None,
            'branch_pattern': None,
        }
        
        # Analyze commit patterns
        recent_commits = session_data.get('recent_commits', '')
        if recent_commits:
            if 'feat:' in recent_commits or 'fix:' in recent_commits:
                patterns['commit_style'] = 'conventional_commits'
            elif re.search(r'[🚀✨🐛🔧📝]', recent_commits):
                patterns['commit_style'] = 'emoji_commits'
            
            # Determine work focus
            if 'feat' in recent_commits.lower():
                patterns['work_focus'].append('feature_development')
            if 'fix' in recent_commits.lower() or 'bug' in recent_commits.lower():
                patterns['work_focus'].append('bug_fixing')
            if 'test' in recent_commits.lower():
                patterns['work_focus'].append('testing')
            if 'refactor' in recent_commits.lower():
                patterns['work_focus'].append('refactoring')
            if 'doc' in recent_commits.lower():
                patterns['work_focus'].append('documentation')
        
        # Analyze file types worked on
        file_changes = session_data.get('file_changes', '')
        if file_changes:
            extensions = set()
            for line in file_changes.split('\n'):
                if len(line) > 2:
                    filename = line[2:].strip()
                    if '.' in filename:
                        ext = filename.split('.')[-1]
                        extensions.add(ext)
            
            patterns['file_types'] = list(extensions)[:5]  # Top 5 extensions
        
        # Analyze change size
        diff_stats = session_data.get('diff_stats', '') + session_data.get('staged_stats', '')
        if diff_stats:
            total_changes = len(re.findall(r'\d+\s+[+-]', diff_stats))
            if total_changes < 10:
                patterns['change_size'] = 'small'
            elif total_changes < 50:
                patterns['change_size'] = 'medium'
            else:
                patterns['change_size'] = 'large'
        
        # Branch pattern
        session_info = session_data.get('session_data', {})
        git_branch = session_info.get('git_branch', '')
        if git_branch:
            if git_branch.startswith('feature/'):
                patterns['branch_pattern'] = 'feature_branch'
            elif git_branch.startswith('fix/') or git_branch.startswith('bugfix/'):
                patterns['branch_pattern'] = 'bugfix_branch'
            elif git_branch.startswith('release/'):
                patterns['branch_pattern'] = 'release_branch'
            elif git_branch in ['main', 'master', 'develop']:
                patterns['branch_pattern'] = 'main_branch'
        
        return patterns
    
    def check_duplicate(self, content: str, timeframe_hours: int = 24) -> bool:
        """Check if similar memory exists in recent timeframe"""
        # For now, skip duplicate checking since we can't query MCP from here
        # Future enhancement: Could store recent hashes in a local file
        return False
    
    def format_memory_content(self, session_data: Dict[str, Any], 
                            significance: float, reasons: List[str],
                            patterns: Dict[str, Any]) -> str:
        """Format memory content for storage"""
        session_info = session_data.get('session_data', {})
        project_name = session_info.get('project_name', 'Unknown Project')
        git_branch = session_info.get('git_branch', 'no-branch')
        
        # Build memory content
        content_parts = [f"Claude session in {project_name}"]
        
        if git_branch and git_branch != 'no-branch':
            content_parts.append(f"on branch {git_branch}")
        
        # Add main accomplishments
        if reasons:
            content_parts.append(f"- {reasons[0]}")
            if len(reasons) > 1:
                content_parts.append(f"- {reasons[1]}")
        
        # Add patterns discovered
        if patterns.get('commit_style'):
            content_parts.append(f"- Used {patterns['commit_style']}")
        
        if patterns.get('work_focus'):
            focus = ', '.join(patterns['work_focus'][:2])
            content_parts.append(f"- Focused on: {focus}")
        
        if patterns.get('change_size'):
            content_parts.append(f"- Change size: {patterns['change_size']}")
        
        return ". ".join(content_parts)
    
    def store_memory(self, content: str, metadata: Dict[str, Any]) -> bool:
        """Store memory using a file that Claude can pick up"""
        # Write to a file that Claude will process when it has MCP access
        memory_queue_file = Path.home() / ".claude" / "scripts" / "memory-queue.jsonl"
        
        try:
            memory_record = {
                "content": content,
                "metadata": metadata,
                "timestamp": datetime.now().isoformat()
            }
            
            # Append to queue file
            with open(memory_queue_file, 'a') as f:
                f.write(json.dumps(memory_record) + '\n')
            
            print(f"Queued memory: {content[:100]}...")
            return True
        except Exception as e:
            print(f"Error queuing memory: {e}")
            return False
    
    def process_session(self, session_file: str):
        """Main processing function"""
        try:
            # Load session data
            with open(session_file, 'r') as f:
                session_data = json.load(f)
            
            # Calculate significance
            significance, reasons = self.calculate_significance(session_data)
            
            print(f"Session significance score: {significance:.1f}")
            print(f"Reasons: {', '.join(reasons)}")
            
            # Check if significant enough
            if significance < self.significance_threshold:
                print(f"Session not significant enough (threshold: {self.significance_threshold})")
                return
            
            # Extract patterns
            patterns = self.extract_patterns(session_data)
            
            # Format memory content
            memory_content = self.format_memory_content(
                session_data, significance, reasons, patterns
            )
            
            # Check for duplicates
            if self.check_duplicate(memory_content):
                print("Similar memory already exists, skipping")
                return
            
            # Prepare metadata
            session_info = session_data.get('session_data', {})
            metadata = {
                'tags': ['session_milestone', 'claude_code', 'automated'],
                'type': 'session_completion',
                'project': session_info.get('project_name', 'unknown'),
                'git_branch': session_info.get('git_branch', ''),
                'git_repo': session_info.get('git_repo', ''),
                'significance_score': significance,
                'timestamp': session_info.get('timestamp', datetime.now().isoformat()),
                'patterns': patterns,
                'reasons': reasons,
            }
            
            # Add domain tags based on patterns
            if patterns.get('work_focus'):
                for focus in patterns['work_focus']:
                    if 'feature' in focus:
                        metadata['tags'].append('coding')
                    elif 'bug' in focus or 'fix' in focus:
                        metadata['tags'].append('debugging')
                    elif 'test' in focus:
                        metadata['tags'].append('testing')
                    elif 'doc' in focus:
                        metadata['tags'].append('documentation')
                    elif 'refactor' in focus:
                        metadata['tags'].append('architecture')
            
            # Add significance level tag
            if significance >= 10:
                metadata['tags'].append('major')
                metadata['significance_level'] = 'major'
            elif significance >= 7:
                metadata['tags'].append('moderate')
                metadata['significance_level'] = 'moderate'
            else:
                metadata['tags'].append('minor')
                metadata['significance_level'] = 'minor'
            
            # Store the memory
            if self.store_memory(memory_content, metadata):
                print(f"Successfully stored session memory")
                
                # Store additional insight if patterns are significant
                if patterns.get('commit_style') or patterns.get('work_focus'):
                    insight_content = f"Work pattern in {session_info.get('project_name', 'project')}: "
                    insight_parts = []
                    
                    if patterns.get('commit_style'):
                        insight_parts.append(f"uses {patterns['commit_style']}")
                    if patterns.get('work_focus'):
                        insight_parts.append(f"focuses on {', '.join(patterns['work_focus'][:2])}")
                    if patterns.get('file_types'):
                        insight_parts.append(f"works with {', '.join(patterns['file_types'][:3])} files")
                    
                    insight_content += ', '.join(insight_parts)
                    
                    insight_metadata = {
                        'tags': ['pattern', 'insight', 'work_style', 'automated'],
                        'type': 'work_pattern',
                        'project': session_info.get('project_name', 'unknown'),
                        'timestamp': datetime.now().isoformat(),
                    }
                    
                    self.store_memory(insight_content, insight_metadata)
                    print("Stored additional work pattern insight")
            
        except Exception as e:
            print(f"Error processing session: {e}")
            import traceback
            traceback.print_exc()

def main():
    """Main entry point"""
    if len(sys.argv) < 2:
        print("Usage: process-session-memory.py <session_file>")
        sys.exit(1)
    
    session_file = sys.argv[1]
    
    if not os.path.exists(session_file):
        print(f"Session file not found: {session_file}")
        sys.exit(1)
    
    processor = SessionMemoryProcessor()
    processor.process_session(session_file)

if __name__ == "__main__":
    main()