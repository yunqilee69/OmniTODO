import CalendarBoard from "../components/CalendarBoard";

/** Standalone calendar (design §13.1): every project, plus the Inbox. The project
 *  view embeds the same board scoped to one project. */
export default function Calendar() {
  return (
    <section className="h-full min-h-0">
      <CalendarBoard />
    </section>
  );
}
