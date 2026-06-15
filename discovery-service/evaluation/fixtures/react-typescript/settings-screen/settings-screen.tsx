
import React from 'react';

export interface SettingsForm {
  username: string;
  email: string;
}

// Settings screen with a form — classified as ui_screen via *Screen suffix
export function SettingsScreen(): JSX.Element {
  return <form><input name="username" /></form>;
}
