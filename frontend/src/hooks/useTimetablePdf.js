import html2pdf from "html2pdf.js";
import useAPI from "./useAPI";

export default function useTimetablePdf(timetableId) {
    const api = useAPI();

    const downloadPdf = async (type) => {
        try {
            // FIXED: Changed URL from /schools/timetable/ to /timetables/
            const res = await api.get(`/timetables/${timetableId}/json/?type=${type}`);
            const { pages } = res.data;

            const container = document.createElement("div");
            container.style.fontFamily = "Arial, sans-serif";
            container.style.fontSize = "10pt";

            const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu"];

            pages.forEach((page, pageIndex) => {
                const pageDiv = document.createElement("div");
                pageDiv.style.padding = "10px";

                const title = document.createElement("h2");
                title.style.textAlign = "center";
                title.style.marginBottom = "15px";
                title.textContent = page.title;
                pageDiv.appendChild(title);

                const table = document.createElement("table");
                table.style.width = "100%";
                table.style.borderCollapse = "collapse";
                table.style.tableLayout = "fixed";

                const thead = document.createElement("thead");
                const headerRow = document.createElement("tr");
                ["Period", ...DAY_NAMES].forEach((h) => {
                    const th = document.createElement("th");
                    th.textContent = h;
                    th.style.border = "1px solid #333";
                    th.style.padding = "6px";
                    th.style.backgroundColor = "#e5e7eb";
                    th.style.fontSize = "9pt";
                    headerRow.appendChild(th);
                });
                thead.appendChild(headerRow);
                table.appendChild(thead);

                const tbody = document.createElement("tbody");
                page.periods.forEach((p) => {
                    const tr = document.createElement("tr");

                    const tdPeriod = document.createElement("td");
                    tdPeriod.innerHTML = `<strong>${p.period}</strong>`;
                    tdPeriod.style.border = "1px solid #333";
                    tdPeriod.style.padding = "6px";
                    tdPeriod.style.textAlign = "center";
                    tr.appendChild(tdPeriod);

                    p.days.forEach((d) => {
                        const td = document.createElement("td");
                        td.style.border = "1px solid #333";
                        td.style.padding = "6px";
                        td.style.verticalAlign = "top";
                        td.style.fontSize = "8pt";
                        td.style.height = "50px";

                        let content = "";
                        if (d.subject) content += `<strong>${d.subject}</strong><br>`;

                        // Logic: Don't show the resource we are currently grouping by
                        if (d.teacher && type !== 'teacher') content += `${d.teacher}<br>`;
                        if (d.student_group && type !== 'grade') content += `G: ${d.student_group}<br>`;
                        if (d.classroom && type !== 'room') content += `Rm: ${d.classroom}`;

                        if (d.covering_teacher) {
                            content += `<div style="color: #b00; margin-top: 4px;"><em>Cov: ${d.covering_teacher}</em></div>`;
                        }

                        td.innerHTML = content || '<span style="color:#ccc">—</span>';
                        tr.appendChild(td);
                    });

                    tbody.appendChild(tr);
                });

                table.appendChild(tbody);
                pageDiv.appendChild(table);

                if (pageIndex < pages.length - 1) {
                    pageDiv.style.pageBreakAfter = "always";
                }

                container.appendChild(pageDiv);
            });

            document.body.appendChild(container);

            const options = {
                margin: [10, 10, 10, 10],
                filename: `timetable_${type}.pdf`,
                image: { type: "jpeg", quality: 0.98 },
                html2canvas: { scale: 2, logging: false, useCORS: true },
                jsPDF: { unit: "mm", format: "a4", orientation: "landscape" },
            };

            await html2pdf().from(container).set(options).save();
            document.body.removeChild(container);
        } catch (error) {
            console.error("Failed to generate PDF:", error);
            alert("Error generating PDF. Please check console.");
        }
    };

    return { downloadPdf };
}