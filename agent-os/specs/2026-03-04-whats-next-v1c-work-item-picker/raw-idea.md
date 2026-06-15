# What's Next v1-C: Implement work-item picker (search + retry + scope-preferred ranking) and navigation to Implement

## Raw Idea/Intent

For "What's Next" actions that route to the Implement screen, require the user to select a specific work item first. When the user clicks an Implement-targeting action, the assistant asks "For which work item?". The user replies with a short text query; the system returns up to 5 clickable work items ranked with in-scope matches first (based on current dashboard scope), but also including out-of-scope matches. If no matches, assistant prompts the user to try again and repeats the search loop. Clicking a result navigates to the Implement screen with that work item selected and the embedded Implement chat ready.

## Key Requirements

- Work-item picker dialog triggered when user clicks Implement-targeting action from What's Next
- Assistant asks "For which work item?"
- User provides text search query
- System returns up to 5 clickable work items
- Ranking prioritizes in-scope matches first (based on current dashboard scope)
- Out-of-scope matches also included
- If no matches found, assistant prompts retry and repeats search loop
- Clicking a work item result navigates to Implement screen
- Selected work item is pre-loaded and Implement chat is ready
