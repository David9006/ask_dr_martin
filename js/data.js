window.ADM = window.ADM || {};

ADM.letter = {
  paragraphs: [
    'Thanks for your question. As people often say, any exercise is better than none, but long-distance running in particular has a lot of benefits.',
    'It is a great sport for beginners — you do not need a gym membership or any special equipment. Just a pair of good running shoes will do. Then, keep it up. There is also no better way to know yourself and to see what you are capable of.',
    'You are also somebody who worries about getting sick. Running will help you get fit and prevent diseases. It will give you good upper and lower body strength. Like any exercise, running increases the flow of blood and oxygen to your brain. It makes your heart stronger and allows more blood to flow around your body. It also strengthens your immune system and reduces the risk of serious health problems, as well as more common illnesses like colds. Besides, anybody who is feeling down can go for a run to cheer themselves up. Even a thirty-minute run will provide relief from aches or tension that you may be suffering due to stress.',
    'If you are new to running, here is some advice for you — it is important to warm up and cool down properly before and after running, so you do not hurt yourself. A warm-up gets your blood flowing faster and prepares your body before you exercise. After a long run, you should jog slowly for ten minutes, then walk for five minutes. Such kind of warm-down relaxes your body after exercise.',
    {
      before: 'For more guidelines on running, ',
      linkText: 'click here',
      href: '#guidelines',
      after: '. I hope this will help!'
    }
  ],
  closing: 'Best Regards,',
  signature: 'Dr. Martin'
};

ADM.letterText = function () {
  return ADM.letter.paragraphs.map(function (paragraph) {
    return typeof paragraph === 'string'
      ? paragraph
      : paragraph.before + paragraph.linkText + paragraph.after;
  }).concat([ADM.letter.closing, ADM.letter.signature]).join('\n\n');
};

ADM.seedQA = [
  {
    id: 'seed-running',
    author: 'Jeremy',
    question: "I'm a bit fed up with getting sick all the time. And I feel awkward failing PE exams. My friend suggested I should try long-distance running. Do you think it will help?",
    answer: 'Hi Jeremy,\n\n' + ADM.letterText()
  }
];

ADM.guidelines = [
  {
    title: 'Before you run',
    items: [
      'Warm up for five minutes: brisk walking, then easy jogging.',
      'Wear shoes with a little life left in the midsole — not the pair you have had for years.',
      'Do not start on a full stomach; leave about two hours after a big meal.'
    ]
  },
  {
    title: 'During the run',
    items: [
      'Keep the pace conversational for most sessions.',
      'Raise your weekly distance by no more than about 10%.',
      'Sip water every twenty minutes when it is warm.'
    ]
  },
  {
    title: 'After you run',
    items: [
      'Cool down: jog slowly for ten minutes, then walk for five.',
      'Stretch calves, hamstrings and hips while your muscles are warm.',
      'Eat something with carbohydrate and protein within an hour of a long run.'
    ]
  },
  {
    title: 'Stop and see a doctor if',
    items: [
      'Pain is sharp, or it changes how you walk.',
      'You have chest pain, dizziness or unusual breathlessness.',
      'Swelling or pain does not settle after two or three days of rest.'
    ]
  }
];

ADM.clubs = [
  {
    id: 'riverside',
    name: 'Riverside Running Club',
    level: 'All levels',
    schedule: 'Tue & Thu · 18:30',
    place: 'Riverside Park, north gate',
    blurb: 'Two social loops of 5 km or 10 km, with a coach at the back so nobody runs alone.'
  },
  {
    id: 'early-bird',
    name: 'Early Bird Walkers',
    level: 'Beginner friendly',
    schedule: 'Mon, Wed & Fri · 07:00',
    place: 'Lakeside loop, café steps',
    blurb: 'A brisk 3 km walk before work. Ideal if you are building up to your first run.'
  },
  {
    id: 'trail-riders',
    name: 'Weekend Trail Riders',
    level: 'Intermediate',
    schedule: 'Sat · 08:00',
    place: 'Hilltop car park',
    blurb: 'A 25 km mixed-surface ride with a coffee stop halfway. Helmets are required.'
  }
];

ADM.news = [
  {
    date: '2026-10-12',
    title: 'New Saturday clinic hours',
    body: 'The practice is now open on Saturdays from 09:00 to 13:00 for sports injuries and running assessments. Walk-ins are welcome, but booked slots come first.'
  },
  {
    date: '2026-09-28',
    title: 'Park run returns to Riverside',
    body: 'The free 5 km timed run is back every Saturday at 09:00. Dr. Martin will be at the finish line on the first weekend to answer questions about pacing and recovery.'
  },
  {
    date: '2026-09-05',
    title: 'Hydration campaign launches',
    body: 'Look out for the water-refill points along the lakeside loop. The campaign aims to cut single-use bottles on the route by half this season.'
  },
  {
    date: '2026-08-19',
    title: 'Ask Dr. Martin answers 500 questions',
    body: 'Half a thousand questions from readers have now been answered. The most asked topic? How to start running without getting injured.'
  }
];

ADM.services = [
  {
    icon: 'chat',
    name: 'Online consultation',
    meta: '30 minutes · video call',
    body: 'Talk through a symptom, a training plan or a test result without leaving home. You get a written summary afterwards.'
  },
  {
    icon: 'heart',
    name: 'Annual health check',
    meta: '45 minutes · in clinic',
    body: 'Blood pressure, resting heart rate, bloods and a movement screen, with a plan for the next twelve months.'
  },
  {
    icon: 'leaf',
    name: 'Nutrition & recovery plan',
    meta: 'Two sessions',
    body: 'Practical eating and sleep advice built around the training you actually do, not an ideal week.'
  },
  {
    icon: 'shoe',
    name: 'Running-injury screening',
    meta: '40 minutes · in clinic',
    body: 'Gait and strength assessment for niggles that keep coming back, plus a graded return-to-running plan.'
  }
];
