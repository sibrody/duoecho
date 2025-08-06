// Options page functionality
document.addEventListener('DOMContentLoaded', function() {
  const tokenInput = document.getElementById('githubToken');
  const ownerInput = document.getElementById('githubOwner');
  const repoInput = document.getElementById('githubRepo');
  const saveBtn = document.getElementById('saveBtn');
  const testBtn = document.getElementById('testBtn');
  const statusDiv = document.getElementById('status');
  const testStatusDiv = document.getElementById('testStatus');
  
  // Load existing settings
  chrome.storage.local.get(['githubToken', 'githubOwner', 'githubRepo'], (result) => {
    if (result.githubToken) {
      tokenInput.value = result.githubToken;
    }
    if (result.githubOwner) {
      ownerInput.value = result.githubOwner;
    }
    if (result.githubRepo) {
      repoInput.value = result.githubRepo;
    }
  });
  
  // Save settings
  saveBtn.addEventListener('click', () => {
    const token = tokenInput.value.trim();
    const owner = ownerInput.value.trim();
    const repo = repoInput.value.trim();
    
    if (!token) {
      showStatus(statusDiv, 'error', 'Please enter a GitHub token');
      return;
    }
    
    if (!owner) {
      showStatus(statusDiv, 'error', 'Please enter your GitHub username or organization');
      return;
    }
    
    if (!repo) {
      showStatus(statusDiv, 'error', 'Please enter a repository name');
      return;
    }
    
    chrome.storage.local.set({ 
      githubToken: token,
      githubOwner: owner,
      githubRepo: repo
    }, () => {
      showStatus(statusDiv, 'success', '✅ Settings saved successfully!');
    });
  });
  
  // Test connection
  testBtn.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    const owner = ownerInput.value.trim();
    const repo = repoInput.value.trim();
    
    if (!token || !owner || !repo) {
      showStatus(testStatusDiv, 'error', 'Please fill in all fields first');
      return;
    }
    
    testBtn.disabled = true;
    testBtn.textContent = 'Testing...';
    
    try {
      // Test the token by fetching user info
      const response = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `token ${token}`,
          'User-Agent': 'DuoEcho-Extension'
        }
      });
      
      if (response.ok) {
        const userData = await response.json();
        showStatus(testStatusDiv, 'success', 
          `✅ Connected successfully! Authenticated as: ${userData.login}`);
        
        // Test repository access
        const repoResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
          headers: {
            'Authorization': `token ${token}`,
            'User-Agent': 'DuoEcho-Extension'
          }
        });
        
        if (repoResponse.ok) {
          showStatus(testStatusDiv, 'success', 
            `✅ Connected successfully! Repository access confirmed for: ${owner}/${repo}`);
        } else if (repoResponse.status === 404) {
          // Try to create the repository
          showStatus(testStatusDiv, 'error', 
            `⚠️ Repository '${owner}/${repo}' not found. Please create it on GitHub first, or ensure the token has 'repo' scope.`);
        } else {
          showStatus(testStatusDiv, 'error', 
            `⚠️ Token works but cannot access repository: ${repoResponse.status}`);
        }
      } else {
        showStatus(testStatusDiv, 'error', 
          `❌ Invalid token or authentication failed: ${response.status}`);
      }
    } catch (error) {
      showStatus(testStatusDiv, 'error', 
        `❌ Connection failed: ${error.message}`);
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = 'Test GitHub Connection';
    }
  });
  
  function showStatus(element, type, message) {
    element.textContent = message;
    element.className = `status ${type}`;
    
    // Auto-hide success messages after 5 seconds
    if (type === 'success') {
      setTimeout(() => {
        element.style.display = 'none';
      }, 5000);
    }
  }
});
