// FIXTURE — must be rejected by `no-react`.
import { useState } from 'react';

export const leak = useState;
