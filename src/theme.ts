export type Theme = 'dark' | 'light';

export class ThemeManager {
  private currentTheme: Theme;

  constructor() {
    const saved = localStorage.getItem('piconote-theme') as Theme;
    this.currentTheme = saved || 'dark';
    this.apply();
  }

  public getTheme(): Theme {
    return this.currentTheme;
  }

  public toggle(): Theme {
    this.currentTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('piconote-theme', this.currentTheme);
    this.apply();
    return this.currentTheme;
  }

  private apply(): void {
    document.documentElement.setAttribute('data-theme', this.currentTheme);
  }
}
