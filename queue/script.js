// Twitch API configuration
const TWITCH_CLIENT_ID = 'YOUR-CLIENT-ID-GOES-HERE'; // Register at dev.twitch.tv
const TWITCH_REDIRECT_URI = 'https://example.com'; // Must match your registered redirect URI
const TWITCH_SCOPES = 'user:read:email clips:edit';

// DOM Elements
const loginBtn = document.getElementById('login-btn');
const userInfo = document.getElementById('user-info');
const queueContainer = document.getElementById('queue-container');
const addClipBtn = document.getElementById('add-clip-btn');
const emptyAddClipBtn = document.getElementById('empty-add-clip');
const addClipModal = document.getElementById('add-clip-modal');
const closeModalBtn = document.querySelector('.close-modal');
const clipPreview = document.getElementById('clip-preview');
const closePreviewBtn = document.querySelector('.close-preview');
const fetchClipBtn = document.getElementById('fetch-clip');
const clipUrlInput = document.getElementById('clip-url');
const recentClipsContainer = document.getElementById('recent-clips');
const viewOptions = document.querySelectorAll('.view-option');
const filterTags = document.querySelectorAll('.tag');
const priorityFilters = document.querySelectorAll('.priority-filter');

// State
let currentUser = null;
let accessToken = null;
let clipsQueue = JSON.parse(localStorage.getItem('clipsQueue')) || [];
let currentView = 'grid';
let currentTagFilter = 'all';
let currentPriorityFilter = 'all';

// Initialize
checkAuth();
updateQueueCount();
renderQueue();
initSortable();

// Event Listeners
loginBtn.addEventListener('click', handleLogin);
addClipBtn.addEventListener('click', () => addClipModal.classList.remove('hidden'));
emptyAddClipBtn.addEventListener('click', () => addClipModal.classList.remove('hidden'));
closeModalBtn.addEventListener('click', () => addClipModal.classList.add('hidden'));
closePreviewBtn.addEventListener('click', () => clipPreview.classList.add('hidden'));
fetchClipBtn.addEventListener('click', handleFetchClip);

viewOptions.forEach(option => {
    option.addEventListener('click', () => {
        viewOptions.forEach(opt => opt.classList.remove('active'));
        option.classList.add('active');
        currentView = option.dataset.view;
        renderQueue();
    });
});

filterTags.forEach(tag => {
    tag.addEventListener('click', () => {
        filterTags.forEach(t => t.classList.remove('active'));
        tag.classList.add('active');
        currentTagFilter = tag.dataset.tag;
        renderQueue();
    });
});

priorityFilters.forEach(filter => {
    filter.addEventListener('click', () => {
        priorityFilters.forEach(f => f.classList.remove('active'));
        filter.classList.add('active');
        currentPriorityFilter = filter.dataset.priority;
        renderQueue();
    });
});

// Functions
function checkAuth() {
    // Check for access token in URL (from OAuth redirect)
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const token = hashParams.get('access_token');
    
    if (token) {
        accessToken = token;
        localStorage.setItem('twitch_access_token', token);
        
        // Remove token from URL
        window.history.replaceState({}, document.title, window.location.pathname);
        
        // Fetch user info
        fetchUserInfo();
    } else {
        // Check for stored token
        const storedToken = localStorage.getItem('twitch_access_token');
        if (storedToken) {
            accessToken = storedToken;
            fetchUserInfo();
        }
    }
}

function handleLogin() {
    // Redirect to Twitch OAuth
    const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${TWITCH_CLIENT_ID}&redirect_uri=${encodeURIComponent(TWITCH_REDIRECT_URI)}&response_type=token&scope=${encodeURIComponent(TWITCH_SCOPES)}`;
    window.location.href = authUrl;
}

async function fetchUserInfo() {
    try {
        const response = await fetch('https://api.twitch.tv/helix/users', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Client-Id': TWITCH_CLIENT_ID
            }
        });
        
        const data = await response.json();
        
        if (data.data && data.data.length > 0) {
            currentUser = data.data[0];
            updateUIAfterLogin();
            loadRecentClips();
        }
    } catch (error) {
        console.error('Error fetching user info:', error);
        logout();
    }
}

function updateUIAfterLogin() {
    loginBtn.classList.add('hidden');
    userInfo.classList.remove('hidden');
    document.getElementById('user-avatar').src = currentUser.profile_image_url;
    document.getElementById('username').textContent = currentUser.display_name;
}

function logout() {
    localStorage.removeItem('twitch_access_token');
    accessToken = null;
    currentUser = null;
    loginBtn.classList.remove('hidden');
    userInfo.classList.add('hidden');
    clipsQueue = [];
    saveQueue();
    renderQueue();
}

async function handleFetchClip() {
    const clipUrl = clipUrlInput.value.trim();
    
    if (!clipUrl) {
        alert('Please enter a clip URL');
        return;
    }
    
    // Extract clip slug from URL
    let clipSlug;
    try {
        const url = new URL(clipUrl);
        clipSlug = url.pathname.split('/').pop();
    } catch (e) {
        alert('Invalid URL format');
        return;
    }
    
    try {
        const clipData = await fetchClipData(clipSlug);
        const newClip = {
            id: clipData.id,
            slug: clipSlug,
            title: clipData.title,
            game: clipData.game_name,
            thumbnail: clipData.thumbnail_url,
            duration: formatDuration(clipData.duration),
            views: clipData.view_count,
            date: clipData.created_at,
            priority: 'medium',
            tags: [],
            notes: ''
        };
        
        addClipToQueue(newClip);
        clipUrlInput.value = '';
        addClipModal.classList.add('hidden');
    } catch (error) {
        console.error('Error fetching clip:', error);
        alert('Failed to fetch clip data. Please check the URL and try again.');
    }
}

async function fetchClipData(clipSlug) {
    const response = await fetch(`https://api.twitch.tv/helix/clips?id=${clipSlug}`, {
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Client-Id': TWITCH_CLIENT_ID
        }
    });
    
    const data = await response.json();
    
    if (!data.data || data.data.length === 0) {
        throw new Error('Clip not found');
    }
    
    return data.data[0];
}

async function loadRecentClips() {
    if (!currentUser) return;
    
    recentClipsContainer.innerHTML = '';
    
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'loading-clips';
    loadingDiv.innerHTML = `
        <i class="fas fa-spinner fa-spin"></i>
        <p>Loading your recent clips...</p>
    `;
    recentClipsContainer.appendChild(loadingDiv);
    
    try {
        // First get the broadcaster ID
        const broadcasterId = currentUser.id;
        
        // Fetch clips created by the broadcaster
        const response = await fetch(`https://api.twitch.tv/helix/clips?broadcaster_id=${broadcasterId}&first=20`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Client-Id': TWITCH_CLIENT_ID
            }
        });
        
        const data = await response.json();
        
        recentClipsContainer.innerHTML = '';
        
        if (!data.data || data.data.length === 0) {
            recentClipsContainer.innerHTML = '<p>No recent clips found</p>';
            return;
        }
        
        data.data.forEach(clip => {
            const clipElement = document.createElement('div');
            clipElement.className = 'recent-clip';
            clipElement.innerHTML = `
                <div class="recent-clip-thumbnail">
                    <img src="${clip.thumbnail_url.replace('-preview-480x272.jpg', '-preview-260x147.jpg')}" alt="${clip.title}">
                    <span class="recent-clip-duration">${formatDuration(clip.duration)}</span>
                </div>
                <div class="recent-clip-info">
                    <div class="recent-clip-title">${clip.title}</div>
                    <div class="recent-clip-meta">
                        <span>${clip.game_name || 'Unknown'}</span>
                        <span>${formatNumber(clip.view_count)} views</span>
                    </div>
                </div>
            `;
            
            clipElement.addEventListener('click', () => {
                const newClip = {
                    id: clip.id,
                    slug: clip.id,
                    title: clip.title,
                    game: clip.game_name,
                    thumbnail: clip.thumbnail_url,
                    duration: formatDuration(clip.duration),
                    views: clip.view_count,
                    date: clip.created_at,
                    priority: 'medium',
                    tags: [],
                    notes: ''
                };
                addClipToQueue(newClip);
                addClipModal.classList.add('hidden');
            });
            
            recentClipsContainer.appendChild(clipElement);
        });
    } catch (error) {
        console.error('Error loading recent clips:', error);
        recentClipsContainer.innerHTML = '<p>Failed to load recent clips</p>';
    }
}

function addClipToQueue(clip) {
    // Check if clip already exists in queue
    if (!clipsQueue.some(c => c.id === clip.id)) {
        clipsQueue.push(clip);
        saveQueue();
        renderQueue();
    } else {
        alert('This clip is already in your queue');
    }
}

function renderQueue() {
    if (clipsQueue.length === 0) {
        queueContainer.innerHTML = `
            <div class="empty-queue">
                <i class="fas fa-clipboard-list"></i>
                <p>Your queue is empty</p>
                <button id="empty-add-clip">Add your first clip</button>
            </div>
        `;
        document.getElementById('empty-add-clip').addEventListener('click', () => {
            addClipModal.classList.remove('hidden');
        });
        return;
    }
    
    // Apply filters
    let filteredClips = [...clipsQueue];
    
    if (currentTagFilter !== 'all') {
        filteredClips = filteredClips.filter(clip => 
            clip.tags.includes(currentTagFilter)
        );
    }
    
    if (currentPriorityFilter !== 'all') {
        filteredClips = filteredClips.filter(clip => 
            clip.priority === currentPriorityFilter
        );
    }
    
    // Clear container
    queueContainer.innerHTML = '';
    
    // Set appropriate class for view type
    queueContainer.className = currentView === 'grid' ? 'queue-grid' : 'queue-list';
    
    // Add clips
    filteredClips.forEach((clip, index) => {
        const clipElement = document.createElement('div');
        clipElement.className = `clip-card ${currentView === 'list' ? 'list-view' : ''}`;
        clipElement.dataset.clipId = clip.id;
        
        // Priority badge
        let priorityBadge = '';
        if (clip.priority === 'high') {
            priorityBadge = '<span class="clip-priority priority-high"><i class="fas fa-arrow-up"></i> High</span>';
        } else if (clip.priority === 'medium') {
            priorityBadge = '<span class="clip-priority priority-medium"><i class="fas fa-equals"></i> Medium</span>';
        } else {
            priorityBadge = '<span class="clip-priority priority-low"><i class="fas fa-arrow-down"></i> Low</span>';
        }
        
        // Tags
        const tagsHtml = clip.tags.map(tag => 
            `<span class="clip-tag">${tag}</span>`
        ).join('');
        
        // Format thumbnail URL to use smaller preview image
        const thumbnailUrl = clip.thumbnail.replace('-preview-480x272.jpg', '-preview-260x147.jpg');
        
        if (currentView === 'grid') {
            clipElement.innerHTML = `
                <div class="clip-thumbnail">
                    <img src="${thumbnailUrl}" alt="${clip.title}">
                    <span class="clip-duration">${clip.duration}</span>
                </div>
                <div class="clip-info">
                    <div class="clip-title">${clip.title}</div>
                    <div class="clip-meta">
                        <span>${clip.game || 'Unknown'}</span>
                        <span>${formatNumber(clip.views)} views</span>
                    </div>
                    <div class="clip-tags">${tagsHtml}</div>
                    ${priorityBadge}
                </div>
            `;
        } else if (currentView === 'list') {
            clipElement.innerHTML = `
                <div class="clip-thumbnail">
                    <img src="${thumbnailUrl}" alt="${clip.title}">
                    <span class="clip-duration">${clip.duration}</span>
                </div>
                <div class="clip-info">
                    <div class="clip-title">${clip.title}</div>
                    <div class="clip-meta">
                        <span>${clip.game || 'Unknown'}</span>
                        <span>${formatDate(clip.date)}</span>
                        <span>${formatNumber(clip.views)} views</span>
                    </div>
                    <div class="clip-tags">${tagsHtml}</div>
                    ${priorityBadge}
                </div>
            `;
        }
        
        clipElement.addEventListener('click', () => openClipPreview(clip));
        queueContainer.appendChild(clipElement);
    });
}

function openClipPreview(clip) {
    document.getElementById('clip-embed').src = `https://clips.twitch.tv/embed?clip=${clip.slug}&parent=${window.location.hostname}`;
    document.getElementById('clip-title').textContent = clip.title;
    document.getElementById('clip-game').textContent = clip.game || 'Unknown';
    document.getElementById('clip-date').textContent = formatDate(clip.date);
    document.getElementById('clip-views').textContent = `${formatNumber(clip.views)} views`;
    document.getElementById('priority-select').value = clip.priority;
    document.getElementById('clip-notes').value = clip.notes || '';
    
    // Update tag selection
    document.querySelectorAll('.tag-option').forEach(tag => {
        tag.classList.toggle('selected', clip.tags.includes(tag.dataset.tag));
    });
    
    // Set up save button
    const saveBtn = document.querySelector('.btn-save');
    saveBtn.onclick = () => {
        const updatedClip = {
            ...clip,
            priority: document.getElementById('priority-select').value,
            notes: document.getElementById('clip-notes').value,
            tags: Array.from(document.querySelectorAll('.tag-option.selected'))
                .map(tag => tag.dataset.tag)
        };
        
        updateClipInQueue(updatedClip);
        clipPreview.classList.add('hidden');
    };
    
    // Set up post button
    const postBtn = document.querySelector('.btn-post');
    postBtn.onclick = () => {
        alert(`Would post "${clip.title}" to social media in a real app`);
    };
    
    // Set up remove button
    const removeBtn = document.querySelector('.btn-remove');
    removeBtn.onclick = () => {
        if (confirm('Remove this clip from your queue?')) {
            removeClipFromQueue(clip.id);
            clipPreview.classList.add('hidden');
        }
    };
    
    clipPreview.classList.remove('hidden');
}

function updateClipInQueue(updatedClip) {
    clipsQueue = clipsQueue.map(clip => 
        clip.id === updatedClip.id ? updatedClip : clip
    );
    saveQueue();
    renderQueue();
}

function removeClipFromQueue(clipId) {
    clipsQueue = clipsQueue.filter(clip => clip.id !== clipId);
    saveQueue();
    renderQueue();
}

function saveQueue() {
    localStorage.setItem('clipsQueue', JSON.stringify(clipsQueue));
    updateQueueCount();
}

function updateQueueCount() {
    document.getElementById('queue-count').textContent = `(${clipsQueue.length})`;
}

function initSortable() {
    new Sortable(queueContainer, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        onEnd: function() {
            // Get new order of clip IDs
            const newOrder = Array.from(queueContainer.children).map(el => el.dataset.clipId);
            
            // Reorder clips array
            clipsQueue.sort((a, b) => 
                newOrder.indexOf(a.id) - newOrder.indexOf(b.id)
            );
            
            saveQueue();
        }
    });
}

// Helper functions
function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatDate(isoString) {
    const date = new Date(isoString);
    return date.toLocaleDateString();
}

function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

// Tag selection in preview
document.querySelectorAll('.tag-option').forEach(tag => {
    tag.addEventListener('click', function() {
        this.classList.toggle('selected');
    });
});