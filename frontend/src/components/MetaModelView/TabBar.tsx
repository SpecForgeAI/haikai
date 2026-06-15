import { useArchitecture, useArchitectureDispatch } from '../../contexts/ArchitectureContext';
import { tabNames } from '../../config/gridConfigs';
import styles from './MetaModelView.module.css';

export function TabBar() {
  const state = useArchitecture();
  const dispatch = useArchitectureDispatch();

  const handleTabClick = (tabName: string) => {
    dispatch({ type: 'SELECT_TAB', payload: tabName });
  };

  return (
    <div className={styles.tabBar}>
      {tabNames.map((tabName) => (
        <button
          key={tabName}
          className={`${styles.tab} ${state.selectedTab === tabName ? styles.activeTab : ''}`}
          onClick={() => handleTabClick(tabName)}
        >
          {tabName}
        </button>
      ))}
    </div>
  );
}
