import React from 'react';
import { useState, useEffect } from 'react';

export const formatName = (name: string) => {
  return name.trim().toUpperCase();
};

export const useCounter = () => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(1);
  }, []);

  return count;
};

export const Screen = () => {
  return <div>screen</div>;
};

export const App = () => {
  return <Screen />;
};

class Logger {
  logs: string[] = [];

  add(log: string) {
    this.logs.push(log);
  }

  getAll() {
    return this.logs;
  }
}

export { Logger };
