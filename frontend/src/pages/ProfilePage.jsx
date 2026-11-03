/**
 * src/pages/ProfilePage.jsx
 * Standalone Profile & Personality page for /profile route
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import UserProfileModal from '../components/UserProfileModal';
import { useProfile } from '../context/ProfileContext';

export default function ProfilePage() {
  const navigate = useNavigate();
  const { profile } = useProfile();

  if (!profile) return null;

  return (
    <div style={{ height: '100vh', background: 'var(--bg-base)' }}>
      <UserProfileModal
        isOpen={true}
        onClose={() => navigate('/chat')}
      />
    </div>
  );
}

