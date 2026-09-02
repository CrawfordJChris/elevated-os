exports.handler = async function(event, context) {
  if(event.httpMethod === 'OPTIONS'){
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if(event.httpMethod !== 'POST'){
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if(!apiKey){
    return { 
      statusCode: 500, 
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'API key not configured' }) 
    };
  }

  let body;
  try { 
    body = JSON.parse(event.body); 
  } catch(e) { 
    return { 
      statusCode: 400, 
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON: ' + e.message }) 
    }; 
  }

  const { message, sessionId, userContext } = body;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  // Fall back to raw messages API - more reliable from Netlify Functions
  const COACH_SYS = `You are the Elevated OS Coach - a coaching system built on Chris Crawford's methodology. You are warm, direct, and conversational. You follow the energy, never a script.

Core: state first, always. One question at a time. Use their exact words back. Outcomes not actions. Brainstorm wide (6-8+ ideas) before narrowing to needle-mover. State activation before and after every decision.

Purpose chain: This could [result]. That [deeper]. That opens [vision]. Use "could" on first link only.

When someone mentions a win - offer to save it: SAVE_WIN:{title:x,note:x,category:business or health or family or other}

Save commands (output on own line):
SAVE_TO_PLAN:{name:x,why:x,step:x,area:business or health or other,sequence:1}
SAVE_VISION:{their exact words}
SAVE_IDEA:{one clear sentence}
SAVE_WIN:{title:x,note:x,category:x}`;

  try {
    const sysContent = userContext 
      ? COACH_SYS + '\n\nUser context:\n' + userContext 
      : COACH_SYS;

    // Build messages array
    const messages = [];
    
    // Add previous chat if resuming (sessionId used as marker only)
    if(body.chatHistory && Array.isArray(body.chatHistory)){
      messages.push(...body.chatHistory.slice(-10));
    }
    
    messages.push({ role: 'user', content: message });

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        system: [{ type: 'text', text: sysContent, cache_control: { type: 'ephemeral' } }],
        messages
      })
    });

    const data = await resp.json();
    
    if(data.error){
      return { 
        statusCode: 400, 
        headers: corsHeaders,
        body: JSON.stringify({ error: data.error.message }) 
      };
    }

    const reply = data.content && data.content.find(b => b.type === 'text');
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ 
        reply: reply ? reply.text : 'Something went wrong.',
        sessionId: sessionId || 'active'
      })
    };

  } catch(e) {
    return { 
      statusCode: 500, 
      headers: corsHeaders,
      body: JSON.stringify({ error: e.message }) 
    };
  }
};
