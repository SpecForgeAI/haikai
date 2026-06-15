from pydantic import BaseModel, Field
from typing import Optional, List

class StoryComponentAnchorRequest(BaseModel):
    """Simple request for generating Storybook stories."""
    component: Optional[str] = Field(None, description="Component name")
    description: Optional[str] = Field(None, description="Component description") 
    stories: Optional[List[str]] = Field(None, description="Story names")
    props: Optional[List[str]] = Field(None, description="Prop names")
    folder: Optional[str] = Field(None, description="Output folder")
    contract_path: Optional[str] = Field(None, description="Path to contract.json")

